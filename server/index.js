import express from "express";
import cors from "cors";
import multer from "multer";
import { fileURLToPath } from "url";
import { dirname, join, extname } from "path";
import { config as dotenvConfig } from "dotenv";
import fs from "fs/promises";
import mime from "mime-types";
import fetch from "node-fetch";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import OpenAI from "openai";
import { fal } from "@fal-ai/client";

dotenvConfig();
if (!process.env.FAL_API_KEY) {
  throw new Error(
    "FAL_API_KEY is not defined. Please check your environment variables."
  );
}
fal.config({ credentials: process.env.FAL_API_KEY });
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UPLOAD_DIR = join(__dirname, "tmp_uploads");
const OUTPUT_DIR = join(__dirname, "tmp_outputs");
await fs.mkdir(UPLOAD_DIR, { recursive: true });
await fs.mkdir(OUTPUT_DIR, { recursive: true });

const UPLOAD_CFG = (() => {
  const raw = (process.env.S3_BUCKET_UPLOADS || "")
    .replace(/^s3:\/\//, "")
    .replace(/\/+\$/, "");
  const [bucket, ...rest] = raw.split("/");
  return { bucket, prefix: rest.join("/") };
})();

const OUTPUT_CFG = (() => {
  const raw = (process.env.S3_BUCKET_OUTPUTS || "")
    .replace(/^s3:\/\//, "")
    .replace(/\/+\$/, "");
  const [bucket, ...rest] = raw.split("/");
  return { bucket, prefix: rest.join("/") };
})();

const s3 = new S3Client({ region: process.env.AWS_REGION });
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG,
});

async function uploadToS3(cfg, localPath, filename) {
  const Body = await fs.readFile(localPath);
  const Key = cfg.prefix ? `${cfg.prefix}/${filename}` : filename;
  await s3.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key,
      Body,
      ContentType: mime.lookup(localPath) || "application/octet-stream",
    })
  );
  return Key;
}

async function signedUrl(bucket, key) {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

const app = express();
app.use(cors());
app.use(express.json());

const storage = multer.diskStorage({
  destination: (_r, _f, cb) => cb(null, UPLOAD_DIR),
  filename: (_r, f, cb) => cb(null, Date.now() + extname(f.originalname)),
});
const upload = multer({ storage });

app.post("/api/generate", upload.single("image"), async (req, res) => {
  try {
    const { mode, artist } = req.body;

    console.log("➡️ /api/generate llamado");
    console.log("   ▶ Modo recibido:", mode);
    console.log("   ▶ Pintor recibido:", artist);

    if (!req.file) {
      console.warn("❌ No se subió ninguna imagen");
      return res.status(400).json({ error: "No image uploaded" });
    }

    // Validación de modos válidos
    if (!["pintor", "caricature"].includes(mode)) {
      console.warn("❌ Modo inválido");
      return res.status(400).json({ error: "Invalid mode" });
    }

    // Opciones de pintores válidas
    const validArtists = [
      "picasso",
      "salvador dali",
      "diego velazquez",
      "joaquin sorolla",
    ];

    // Si el modo es pintor, debe venir el parámetro artist y ser uno válido
    if (mode === "pintor") {
      if (!artist || !validArtists.includes(artist)) {
        return res
          .status(400)
          .json({ error: "Invalid or missing artist for mode 'pintor'" });
      }
    }

    // Generar el prompt según el modo y el pintor elegido
    let promptText = "";
    if (mode === "pintor") {
      switch (artist) {
        case "picasso":
          promptText = `Transforma esta imagen en una obra al estilo de Pablo Picasso:
- **Cubismo**: Deconstruye y reorganiza las formas en estructuras geométricas, mostrando múltiples perspectivas a la vez.
- **Paleta de color**: Utiliza tonos apagados como marrones, grises y negros.
- **Líneas y planos**: Usa líneas definidas y planos superpuestos.
- **Influencia de sus periodos Azul y Rosa**.`;
          break;
        case "salvador dali":
          promptText = `Transforma esta imagen en una obra al estilo de Salvador Dalí:
- **Surrealismo**: Incorpora elementos oníricos y paisajes distorsionados.
- **Colores vivos** y detalles realistas con formas imposibles o fantásticas.
- **Relojes derretidos** o referencias a objetos surrealistas.`;
          break;
        case "diego velazquez":
          promptText = `Transform this image into a painting in the style of Diego Velázquez. Use detailed realism, dramatic Baroque lighting, and a rich, atmospheric background inspired by Velázquez’s masterpieces. The scene must include a dark, elegant, and subtle background, emphasizing depth and the painter’s classic mood.`;
          break;
        case "joaquin sorolla":
          promptText = `Transforma esta imagen en una obra al estilo de Joaquín Sorolla:
- **Impresionismo español**: Utiliza pinceladas sueltas y luminosas.
- **Colores vivos y claros** para capturar la luz mediterránea.
- **Escenas al aire libre o costeras**.`;
          break;
        default:
          promptText =
            "Transforma esta imagen al estilo del pintor seleccionado.";
      }
    } else {
      promptText = `Externia caricatura a Humoristic caricature`;
    }

    console.log("   ▶ Prompt para generación de imagen:", promptText);

    const imageBuffer = await fs.readFile(req.file.path);
    const imageBase64 = imageBuffer.toString("base64");
    const mimeType = mime.lookup(req.file.path) || "application/octet-stream";

    let resultUrl, responseId, imageCallId;

    if (mode === "caricature") {
      // 1. Subir imagen a S3 uploads
      const uploadKey = await uploadToS3(
        UPLOAD_CFG,
        req.file.path,
        req.file.filename
      );

      const imageUrl = await signedUrl(UPLOAD_CFG.bucket, uploadKey);

      if (
        !imageUrl ||
        typeof imageUrl !== "string" ||
        !imageUrl.startsWith("http")
      ) {
        throw new Error("La URL de la imagen generada es inválida");
      }
      // 2. Llamar a FAL AI usando subscribe (NO STREAM)
      const result = await fal.subscribe("fal-ai/flux-kontext-lora", {
        input: {
          prompt: "Externia caricatura a Humoristic caricature",
          loras: [
            {
              path: "https://v3.fal.media/files/lion/4qvmL3bZKmfNlgAMPihHD_adapter_model.safetensors",
              scale: 1,
            },
          ],
          image_url: imageUrl,
        },
        logs: true,
        onQueueUpdate: (update) => {
          // Opcional: logs para debug
          if (update.status === "IN_PROGRESS") {
            update.logs.map((log) => log.message).forEach(console.log);
          }
        },
      });

      const outputUrl =
        result.data?.images?.[0]?.url || result.data?.url || null;

      if (!outputUrl) {
        throw new Error("No se recibió una imagen generada de FAL");
      }

      // 3. Descargar imagen, guardar local y subir a S3 outputs
      const outputResp = await fetch(outputUrl);
      const buf = Buffer.from(await outputResp.arrayBuffer());
      const fname = `${Date.now()}-fal.png`;
      const localOut = join(OUTPUT_DIR, fname);
      await fs.writeFile(localOut, buf);
      const s3key = await uploadToS3(OUTPUT_CFG, localOut, fname);
      resultUrl = await signedUrl(OUTPUT_CFG.bucket, s3key);

      responseId = result.requestId || "fal-" + Date.now();
      imageCallId = result.requestId || "fal-" + Date.now();

      // 4. Devolver resultado igual que siempre
      return res.json({
        resultUrl,
        responseId,
        imageCallId,
      });
    } else {
      // --- CÓDIGO VIEJO OPENAI PARA PINTOR ---
      const gen = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_image",
                image_url: `data:${mimeType};base64,${imageBase64}`,
              },
              {
                type: "input_text",
                text: promptText,
              },
            ],
          },
        ],
        tools: [
          {
            type: "image_generation",
            background: "transparent",
            size: "1024x1024",
            quality: "medium",
          },
        ],
        tool_choice: { type: "image_generation" },
      });

      const call = gen.output.find((o) => o.type === "image_generation_call");
      if (!call?.result) throw new Error("No image returned");
      const buf = Buffer.from(call.result, "base64");
      const fname = `${Date.now()}.png`;
      const localOut = join(OUTPUT_DIR, fname);
      await fs.writeFile(localOut, buf);
      const s3key = await uploadToS3(OUTPUT_CFG, localOut, fname);
      resultUrl = await signedUrl(OUTPUT_CFG.bucket, s3key);
      responseId = gen.id;
      imageCallId = call.id;

      return res.json({
        resultUrl,
        responseId,
        imageCallId,
      });
    }
  } catch (err) {
    console.error("❌ /api/generate error:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/download-image", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || !url.includes(OUTPUT_CFG.bucket)) {
      return res.status(400).json({ error: "Invalid or missing URL" });
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch image from S3");
    const buffer = await response.arrayBuffer();
    const filename = `ilustracion_ing_${Date.now()}.png`;
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", buffer.byteLength);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Download error:", error);
    res.status(500).json({ error: "Failed to download image" });
  }
});

const CLIENT_DIST = join(__dirname, "../client/dist");
app.use(express.static(CLIENT_DIST));
app.get("*", (_req, res) => {
  res.sendFile(join(CLIENT_DIST, "index.html"));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`⚡ API listening on port ${PORT}`));
