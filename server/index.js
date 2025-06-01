import express from "express";
import cors from "cors";
import multer from "multer";
import { fileURLToPath } from "url";
import { dirname, join, extname, basename } from "path";
import { config as dotenvConfig } from "dotenv";
import fs from "fs/promises";
import mime from "mime-types";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import OpenAI from "openai";

// 1) Carga .env
dotenvConfig();

// 2) Setup de carpetas temporales
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const UPLOAD_DIR = join(__dirname, "tmp_uploads");
const OUTPUT_DIR = join(__dirname, "tmp_outputs");
await fs.mkdir(UPLOAD_DIR, { recursive: true });
await fs.mkdir(OUTPUT_DIR, { recursive: true });

// 3) Configuración de buckets S3 (sin el prefijo "s3://", ni slash final)
function parseBucket(envVar) {
  const raw = (process.env[envVar] || "")
    .replace(/^s3:\/\//, "")
    .replace(/\/+$/, "");
  const [bucket, ...rest] = raw.split("/");
  const prefix = rest.join("/");
  return { bucket, prefix };
}
const BRAND_CFG  = parseBucket("S3_BUCKET_BRAND_KIT");
const UPLOAD_CFG = parseBucket("S3_BUCKET_UPLOADS");
const OUTPUT_CFG = parseBucket("S3_BUCKET_OUTPUTS");
console.log("✅ S3 buckets:", { BRAND_CFG, UPLOAD_CFG, OUTPUT_CFG });

// 4) Clientes S3 y OpenAI
const s3     = new S3Client({ region: process.env.AWS_REGION });
const openai = new OpenAI({
  apiKey:       process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG
});

// 5) Helpers S3

/**
 * Devuelve un Data URL (base64) a partir de la clave de un objeto en S3.
 * Usa GetObjectCommand para leer el buffer completo.
 */
async function getObjectAsDataURL(bucketName, key) {
  const getCmd = new GetObjectCommand({ Bucket: bucketName, Key: key });
  const data   = await s3.send(getCmd);
  // data.Body es un ReadableStream; lo convertimos a Buffer:
  const chunks = [];
  for await (const chunk of data.Body) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  const mimeType = mime.lookup(key) || "application/octet-stream";
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

/**
 * Devuelve un URL firmado (presigned) para lectura en S3 (usado sólo para devolver al cliente
 * la URL de la imagen generada).
 */
async function signedUrl(bucket, key) {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

/**
 * Sube un archivo local a S3 (se leen los bytes con fs.readFile),
 * devuelve la Key usada (prefijo + nombre) para futuras referencias.
 */
async function uploadToS3(cfg, localPath, filename) {
  const Body = await fs.readFile(localPath);
  const Key  = cfg.prefix ? `${cfg.prefix}/${filename}` : filename;
  console.log(`➡️ Subiendo a S3 ${cfg.bucket}/${Key}`);
  await s3.send(new PutObjectCommand({
    Bucket:      cfg.bucket,
    Key,
    Body,
    ContentType: mime.lookup(localPath) || "application/octet-stream"
  }));
  return Key;
}

// 6) Leer listado de iconos en S3 (brand kit)
async function listAllIcons() {
  const res = await s3.send(new ListObjectsV2Command({
    Bucket: BRAND_CFG.bucket,
    Prefix: BRAND_CFG.prefix + "/"
  }));
  return (res.Contents || [])
    .filter(o => /\.(png|jpe?g)$/i.test(o.Key))
    .map(o => ({
      key:   o.Key,
      title: basename(o.Key, extname(o.Key))
    }));
}

// 7) Embeddings + cosine similarity
function cosineSim(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return magA && magB ? dot / Math.sqrt(magA * magA * magB * magB) : 0;
}

async function chooseBrandRefs(description, k = 10) {
  const icons  = await listAllIcons();
  const titles = icons.map(i => i.title);
  // Pedimos embed a todos los titles
  const [{ data: embs }]    = await Promise.all([
    openai.embeddings.create({ model: "text-embedding-3-small", input: titles })
  ]);
  // Embed de la descripción
  const [{ data: descEmb }]  = await Promise.all([
    openai.embeddings.create({ model: "text-embedding-3-small", input: [description] })
  ]);
  const descVec = descEmb[0].embedding;
  // Score y orden
  return embs
    .map((e, i) => ({ ...icons[i], score: cosineSim(e.embedding, descVec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// 8) Convierte un file local a Data URL base64 (lo usamos para la descripción visual)
async function imageFileToDataURL(fp) {
  const buf  = await fs.readFile(fp);
  const type = mime.lookup(fp) || "application/octet-stream";
  return `data:${type};base64,${buf.toString("base64")}`;
}

// 9) Servidor Express
const app = express();
app.use(cors());
app.use(express.json());

// Multer temporal para recibir la imagen subida por el usuario
const storage = multer.diskStorage({
  destination: (_r, _f, cb) => cb(null, UPLOAD_DIR),
  filename:    (_r, f, cb)  => cb(null, Date.now() + extname(f.originalname))
});
const upload = multer({ storage });

/** 
 * POST /api/generate
 * 1) Recibe la imagen del cliente (req.file). 
 * 2) Llama a GPT-4o para describir hasta 1000 caracteres, 
 *    incluyendo posición de elementos e interpretación. 
 * 3) Selecciona 10 imágenes de referencia (top10). 
 * 4) Lee cada referencia desde S3 y lo convierte a Data URL. 
 * 5) Llama a GPT-4.1-mini (image_generation) enviando: 
 *       - Un bloque de texto con el prompt general. 
 *       - 10 Data URLs como `input_image`. 
 * 6) Guarda la imagen resultante en local y la sube a S3 (outputs). 
 * 7) Devuelve al cliente el signedUrl para la imagen generada 
 *    y un array con `{ title, url: Data URL de cada ref }`. 
 */
app.post("/api/generate", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      console.warn("❌ /api/generate: no file");
      return res.status(400).json({ error: "No image uploaded" });
    }
    console.log("➡️ /api/generate");

    // 1) Pedir descripción extendida a GPT-4o-mini (hasta 1000 chars, con posiciones)
    const vision = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [{
        role: "user",
        content: [
          { type: "input_image", image_url: await imageFileToDataURL(req.file.path) },
          {
            type: "input_text",
            text:
              "Describe what you see in this image in up to 1000 characters " +
              "as an interpretation—not focusing on materials—" +
              "but including positions (e.g., 'The lion is centered, facing right; behind it is a sunset on the left, trees on the right')."
          }
        ]
      }]
    });
    const msg = vision.output[0];
    const description = Array.isArray(msg.content)
      ? msg.content.map(c => c.text || "").join(" ").trim()
      : typeof msg.content === "string"
        ? msg.content.trim()
        : msg.content.text?.trim() || "";
    console.log("   ▶ description:", description);

    // 2) Elegir las 10 referencias más afines por embedding
    const refs = await chooseBrandRefs(description, 10);
    console.log("   ▶ refs:", refs.map(r => r.title));

    // 3) Convertir cada referencia a Data URL (base64) leyendo desde S3
    const refDataURLs = await Promise.all(
      refs.map(r => getObjectAsDataURL(BRAND_CFG.bucket, r.key))
    );

    // 4) Construir el prompt textual base (sin incluir imágenes aún)
    const promptText =
      `Generate a flat, vector-based icon of ${description} on a transparent background. ` +
      `Follow ING’s illustration style: light-hearted humor, simple geometric shapes without strokes, subtle unique details. ` +
      `Apply accent color #FF6200 sparingly and use secondary palette for contrast. ` +
      `Use the following reference images to guide style (do not paste materials, just imitate style):`;

    console.log("   ▶ prompt:", promptText);

    // 5) Llamar a GPT-4.1-mini para generar la imagen, pasando:
    //    - Un bloque de input_text con promptText
    //    - 10 bloque input_image con cada Data URL de referencia
    const gen = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: promptText },
          ...refDataURLs.map(dataURL => ({ type: "input_image", image_url: dataURL }))
        ]
      }],
      tools: [{
        type:       "image_generation",
        background: "transparent",
        size:       "auto",
        quality:    "high"
      }]
    });

    // Extraer la imagen generada
    const call = gen.output.find(o => o.type === "image_generation_call");
    if (!call?.result) throw new Error("No image returned");
    console.log("   ✅ generated");

    // 6) Guardar en local + subir a S3 (outputs)
    const buf   = Buffer.from(call.result, "base64");
    const fname = `${Date.now()}.png`;
    const localOut = join(OUTPUT_DIR, fname);
    await fs.writeFile(localOut, buf);
    const s3key = await uploadToS3(OUTPUT_CFG, localOut, fname);
    console.log("   ✅ uploaded to outputs:", s3key);

    // 7) Generar signed URL de la imagen resultante
    const resultUrl = await signedUrl(OUTPUT_CFG.bucket, s3key);

    // 8) Para que el cliente muestre las miniaturas, también devolvemos las Data URLs
    //    de cada referencia junto a su título:
    const brandRefs = refs.map((r, i) => ({
      title: r.title,
      url:   refDataURLs[i]    // el Data URL base64 leído de S3
    }));

    return res.json({
      resultUrl,
      brandRefs,
      responseId: gen.id
    });
  } catch (err) {
    console.error("❌ /api/generate error:", err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/iterate
 * Igual que antes: no llevamos nuevas referencias. Se envía un prompt
 * textual simple (ej. “Change color palette to …”) y se recibe de nuevo
 * una única imagen resultante para iterar.
 */
app.post("/api/iterate", async (req, res) => {
  try {
    const { previousResponseId, action, actionParam } = req.body;
    if (!previousResponseId) {
      console.warn("❌ /api/iterate: missing previousResponseId");
      return res.status(400).json({ error: "Missing previousResponseId" });
    }
    console.log("➡️ /api/iterate", action, actionParam);

    // 1) Sugerir título con IA
    if (action === "suggest_title") {
      const tit = await openai.responses.create({
        model:                "gpt-4.1-mini",
        previous_response_id: previousResponseId,
        input:                "Suggest a catchy, original title for this illustration."
      });
      const out = tit.output[0];
      const sug = Array.isArray(out.content)
        ? out.content.map(c => c.text || "").join(" ").trim()
        : typeof out.content === "string"
          ? out.content.trim()
          : out.content.text?.trim() || "";
      return res.json({ suggestedTitle: sug });
    }

    // 2) Validar que add_title reciba param
    if (action === "add_title" && !actionParam) {
      console.warn("❌ /api/iterate add_title without param");
      return res.status(400).json({ error: "add_title requires a text parameter" });
    }

    // 3) Mapear cada acción a un prompt textual
    const templates = {
      change_palette: p => `Change color palette to ${p}.`,
      scale_up:       () => `Increase the size of the main object.`,
      scale_down:     () => `Decrease the size of the main object.`,
      move_left:      () => `Move the main object slightly to the left.`,
      move_right:     () => `Move the main object slightly to the right.`,
      add_title:      p => `Add the following title below the image: "${p}".`
    };
    const text = templates[action]?.(actionParam) || `Apply modification: ${action}.`;
    console.log("   ▶ iteration prompt:", text);

    // 4) Llamada multi-turn: pedimos nueva imagen usando previousResponseId
    const it = await openai.responses.create({
      model:                "gpt-4.1-mini",
      previous_response_id: previousResponseId,
      input:                text,
      tools: [{
        type:       "image_generation",
        background: "transparent",
        size:       "auto",
        quality:    "high"
      }]
    });
    const call2 = it.output.find(o => o.type === "image_generation_call");
    if (!call2?.result) throw new Error("No image returned");
    console.log("   ✅ iteration generated");

    // 5) Guardar + subir a S3 (outputs)
    const buf2   = Buffer.from(call2.result, "base64");
    const fname2 = `${Date.now()}.png`;
    const local2 = join(OUTPUT_DIR, fname2);
    await fs.writeFile(local2, buf2);
    const key2   = await uploadToS3(OUTPUT_CFG, local2, fname2);
    console.log("   ✅ iteration uploaded:", key2);

    // 6) Devolver al cliente el signed URL de la nueva imagen
    return res.json({
      resultUrl: await signedUrl(OUTPUT_CFG.bucket, key2),
      responseId: it.id
    });
  } catch (err) {
    console.error("❌ /api/iterate error:", err);
    return res.status(500).json({ error: err.message });
  }
});

//  No ruta de descarga directa; el cliente debe usar el signed URL de resultUrl
app.get("/api/download/:file", (_req, res) =>
  res.status(404).send("Use the signed URL in resultUrl")
);

// 10) Servir el frontend React compilado desde client/dist
const CLIENT_DIST = join(__dirname, "../client/dist");
app.use(express.static(CLIENT_DIST));
app.get("*", (_req, res) => {
  res.sendFile(join(CLIENT_DIST, "index.html"));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`⚡ API listening on port ${PORT}`));
