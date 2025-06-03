import express from "express";
import cors from "cors";
import multer from "multer";
import { fileURLToPath } from "url";
import { dirname, join, extname, basename } from "path";
import { config as dotenvConfig } from "dotenv";
import fs from "fs/promises";
import mime from "mime-types";
import fetch from "node-fetch"; // Para descargar la imagen firmada
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

// 3) Configuración de buckets S3 (sin prefijo ni slash final)
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
async function getObjectAsDataURL(bucketName, key) {
  const getCmd = new GetObjectCommand({ Bucket: bucketName, Key: key });
  const data   = await s3.send(getCmd);
  // Convertir ReadableStream a Buffer
  const chunks = [];
  for await (const chunk of data.Body) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  const mimeType = mime.lookup(key) || "application/octet-stream";
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function signedUrl(bucket, key) {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

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

async function chooseBrandRefs(description, k = 5) {
  const icons  = await listAllIcons();
  const titles = icons.map(i => i.title);
  const [{ data: embs }]   = await Promise.all([
    openai.embeddings.create({ model: "text-embedding-3-small", input: titles })
  ]);
  const [{ data: descEmb }] = await Promise.all([
    openai.embeddings.create({ model: "text-embedding-3-small", input: [description] })
  ]);
  const descVec = descEmb[0].embedding;
  return embs
    .map((e, i) => ({ ...icons[i], score: cosineSim(e.embedding, descVec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// 8) Convertir archivo local a Data URL base64
async function imageFileToDataURL(fp) {
  const buf  = await fs.readFile(fp);
  const type = mime.lookup(fp) || "application/octet-stream";
  return `data:${type};base64,${buf.toString("base64")}`;
}

// 9) Servidor Express
const app = express();
app.use(cors());
app.use(express.json());

const storage = multer.diskStorage({
  destination: (_r, _f, cb) => cb(null, UPLOAD_DIR),
  filename:    (_r, f, cb)  => cb(null, Date.now() + extname(f.originalname))
});
const upload = multer({ storage });

/**
 * POST /api/generate
 *   1) Recibe una imagen.
 *   2) GPT-4o‐mini describe (hasta 250 caracteres) con posiciones e interpretación.
 *   3) Selecciona 5 referencias (top 5 por embedding).
 *   4) Lee cada referencia desde S3 → Data URL.
 *   5) GPT‐4.1‐mini (image_generation) recibe promptText + 5 Data URLs.
 *   6) Guarda imagen resultante y sube a S3.
 *   7) Devuelve resultUrl, brandRefs, description, responseId e imageCallId.
 */
app.post("/api/generate", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      console.warn("❌ /api/generate: no file");
      return res.status(400).json({ error: "No image uploaded" });
    }
    console.log("➡️ /api/generate");

    // 1) Descripción con GPT-4o‐mini (hasta 250 caracteres)
    const vision = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [{
        role: "user",
        content: [
          { type: "input_image", image_url: await imageFileToDataURL(req.file.path) },
          {
            type: "input_text",
            text:
              "You are a graphic designer. Describe what you see in this image in up to 250 characters, " +
              "as an interpretation—without focusing on materials or style—of what the user wanted to represent. " +
              "Include positions of all objects."
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

    // 2) Elegir las 5 referencias más afines por embedding
    const refs = await chooseBrandRefs(description, 5);
    console.log("   ▶ refs:", refs.map(r => r.title));

    // 3) Convertir cada referencia a Data URL
    const refDataURLs = await Promise.all(
      refs.map(r => getObjectAsDataURL(BRAND_CFG.bucket, r.key))
    );

    // 4) Construir prompt textual base (con inventario de elementos)
    const promptText =
      "Generate a flat, vector-based icon illustration on a transparent background. " +
      "Follow this illustration style: light-hearted humor, simple geometric shapes without strokes, subtle unique details. " +
      "The image must contain exactly: " + description + ". " +
      "Use the following reference images to repeat the exact style (do not paste materials, just imitate style):";
    console.log("   ▶ prompt:", promptText);

    // 5) Llamada a GPT‐4.1‐mini (image_generation) con temperatura baja
    const gen = await openai.responses.create({
      model:       "gpt-4.1-mini",
      temperature: 0.4,
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

    // 5.1) Extraer ID de image_generation_call
    const call = gen.output.find(o => o.type === "image_generation_call");
    if (!call?.result) throw new Error("No image returned");
    console.log("   ✅ generated; imageCallId=", call.id);

    // 6) Guardar + subir a S3
    const buf   = Buffer.from(call.result, "base64");
    const fname = `${Date.now()}.png`;
    const localOut = join(OUTPUT_DIR, fname);
    await fs.writeFile(localOut, buf);
    const s3key = await uploadToS3(OUTPUT_CFG, localOut, fname);
    console.log("   ✅ uploaded to outputs:", s3key);

    // 7) Obtener signed URL
    const resultUrl = await signedUrl(OUTPUT_CFG.bucket, s3key);

    // 8) Preparar miniaturas de referencias para el cliente
    const brandRefs = refs.map((r, i) => ({
      title: r.title,
      url:   refDataURLs[i]
    }));

    // 9) Responder al cliente con todo
    return res.json({
      resultUrl,
      brandRefs,
      description,      // enviamos la descripción original aquí
      responseId:  gen.id,
      imageCallId: call.id
    });
  } catch (err) {
    console.error("❌ /api/generate error:", err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/iterate
 *   1) Recibe previousResponseId + imageCallId + action (+ actionParam opcional) + originalDescription.
 *   2) Para “suggest_title” se comporta igual que antes.
 *   3) Para “add_title”, “change_palette”, etc. → mapea la acción a texto.
 *   4) Para “chat”: 
 *       a) Descarga la imagen anterior (prevImageUrl) y la convierte a Data URL.
 *       b) Pide a GPT-4o-mini una mini-descripción del objeto principal (150 caracteres).
 *       c) Reescribe la instrucción del usuario con GPT-4.1-nano (temperatura 0) incluyendo mini-descripción.
 *       d) Llama a GPT-4.1-mini con:
 *          – bloque system recordando paleta ING,
 *          – texto reescrito,
 *          – input_image con Data URL de la imagen previa,
 *          – image_generation_call con id anterior.
 *   5) Sube la imagen nueva a S3 y devuelve signed URL, responseId e imageCallId.
 */
app.post("/api/iterate", async (req, res) => {
  try {
    const { previousResponseId, imageCallId, action, actionParam, originalDescription } = req.body;
    if (!previousResponseId || !imageCallId) {
      console.warn("❌ /api/iterate: missing previousResponseId or imageCallId");
      return res.status(400).json({ error: "Missing previousResponseId or imageCallId" });
    }

    console.log(
      "➡️ /api/iterate",
      action, actionParam,
      "prevResp:", previousResponseId,
      "callId:", imageCallId,
      "origDesc:", originalDescription
    );

    // --------------- Validación de longitud en backend ---------------
    const CHAT_BACKEND_MAX = 250;
    if (action === "chat") {
      if (!actionParam) {
        console.warn("❌ /api/iterate chat without actionParam");
        return res.status(400).json({ error: "chat requires a text parameter" });
      }
      if (
        !originalDescription ||
        typeof originalDescription.prevImageUrl !== "string"
      ) {
        console.warn("❌ /api/iterate chat without originalDescription.prevImageUrl");
        return res.status(400).json({
          error: "originalDescription.prevImageUrl is required for chat"
        });
      }
      if (actionParam.length > CHAT_BACKEND_MAX) {
        return res.status(400).json({
          error: `Instrucción demasiado larga: máximo ${CHAT_BACKEND_MAX} caracteres.`
        });
      }
    }
    // ------------------------------------------------------------------

    // --- Caso “Modificar vía chat”: reescribir el texto con gpt-4.1-nano ---
    if (action === "chat") {
      // 1) Descarga la imagen previa desde S3 (prevImageUrl) y conviértela a Data URL
      const prevImageUrl = originalDescription.prevImageUrl;
      // Usamos fetch para descargar la imagen de la URL firmada
      const respRaw = await fetch(prevImageUrl);
      if (!respRaw.ok) {
        throw new Error("No se pudo descargar la imagen previa desde S3");
      }
      const arrayBuf = await respRaw.arrayBuffer();
      const bufPrev  = Buffer.from(arrayBuf);
      // Asumimos PNG, pero podrías detectar por extensión
      const dataURLPrev = `data:image/png;base64,${bufPrev.toString("base64")}`;

      // 2) Pedir mini-descripción del objeto principal con GPT-4o-mini (150 caracteres)
      const vis = await openai.responses.create({
        model: "gpt-4o-mini",
        input: [{
          role: "user",
          content: [
            { type: "input_image", image_url: dataURLPrev },
            {
              type: "input_text",
              text:
                "Resume en 150 caracteres la forma, posición y detalles geométricos del objeto principal en esta imagen, sin mencionar estilo ni colores."
            }
          ]
        }]
      });
      const visMsg = vis.output[0];
      const miniDesc = Array.isArray(visMsg.content)
        ? visMsg.content.map(c => c.text || "").join(" ").trim()
        : typeof visMsg.content === "string"
          ? visMsg.content.trim()
          : visMsg.content.text?.trim() || "";
      console.log("   ▶ miniDesc:", miniDesc);

      // 3) Reescribir la instrucción libre con GPT-4.1-nano (temperatura 0)
      const RAW_LIMIT = 150;
      const rawInstr = actionParam.length > RAW_LIMIT
        ? actionParam.slice(0, RAW_LIMIT) + "…"
        : actionParam;

      const rewritePrompt = `
You are an AI style police for ING’s illustration prompts.
Previous image shows: "${miniDesc}".
Rewrite the user’s instruction so that:
- Never leave ING’s style: light-hearted humor, simple geometric shapes without strokes, and subtle details.
- Do not mention shadows, complex edges, realistic textures, or any effect that contradicts the flat and vector-based guideline.
- Keep the same main object exactly as described: "${miniDesc}".
- Limit your answer to under 200 characters, only rewriting the instruction (no explanations).

Client’s raw instruction:
"${rawInstr.replace(/"/g, '\\"')}"
      `.trim();

      const rewriteResponse = await openai.responses.create({
        model:       "gpt-4.1-nano",
        temperature: 0.3,
        input: [
          { role: "user", content: rewritePrompt }
        ]
      });
      const rewrittenRaw = rewriteResponse.output[0];
      const rewrittenText = Array.isArray(rewrittenRaw.content)
        ? rewrittenRaw.content.map(c => c.text || "").join(" ").trim()
        : typeof rewrittenRaw.content === "string"
          ? rewrittenRaw.content.trim()
          : rewrittenRaw.content.text?.trim() || "";
      console.log("   ▶[chat] Original user text:", actionParam);
      console.log("   ▶[chat] Rewritten text:", rewrittenText);

      // 4) Llamar a GPT-4.1-mini con el bloque SYSTEM, reescrito e input_image (Data URL) + image_generation_call
      const itChat = await openai.responses.create({
        model:       "gpt-4.1-mini",
        temperature: 0.3,
        input: [
          {
            role: "system",
            content:
              "ING style: accent color #FF6200 sparingly, flat shapes, light-hearted humor, simple geometric forms without strokes, no shadows."
          },
          {
            role: "user",
            content: [
              { type: "input_text",  text: rewrittenText },
              { type: "input_image", image_url: dataURLPrev }
            ]
          },
          { type: "image_generation_call", id: imageCallId }
        ],
        tools: [{
          type:       "image_generation",
          background: "transparent",
          size:       "auto",
          quality:    "high"
        }]
      });
      const callChat = itChat.output.find(o => o.type === "image_generation_call");
      if (!callChat?.result) throw new Error("No image returned from chat iteration");
      console.log("   ✅ [chat] iteration generated; new imageCallId=", callChat.id);

      // 5) Guardar + subir a S3
      const buf2Chat   = Buffer.from(callChat.result, "base64");
      const fname2Chat = `${Date.now()}.png`;
      const local2Chat = join(OUTPUT_DIR, fname2Chat);
      await fs.writeFile(local2Chat, buf2Chat);
      const key2Chat   = await uploadToS3(OUTPUT_CFG, local2Chat, fname2Chat);
      console.log("   ✅ [chat] iteration uploaded:", key2Chat);

      // 6) Obtener signed URL y responder
      const newUrl = await signedUrl(OUTPUT_CFG.bucket, key2Chat);
      return res.json({
        resultUrl:   newUrl,
        responseId:  itChat.id,
        imageCallId: callChat.id
      });
    }

    // 1) Sugerir título con IA (igual que antes)
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

    // 2) Validar que add_title reciba actionParam
    if (action === "add_title" && !actionParam) {
      console.warn("❌ /api/iterate add_title without param");
      return res.status(400).json({ error: "add_title requires a text parameter" });
    }

    // 3) Mapear las acciones conocidas (para cambios “no chat”)
    const templates = {
      change_palette: p => `Change color palette to ${p}.`,
      scale_up:       () => `Increase the size of the main object.`,
      scale_down:     () => `Decrease the size of the main object.`,
      move_left:      () => `Move the main object slightly to the left.`,
      move_right:     () => `Move the main object slightly to the right.`,
      add_title:      p => `Add the following title below the image: "${p}".`
    };

    // 4) Text para iteraciones no-chat
    const text = action === "chat"
      ? actionParam
      : (templates[action]?.(actionParam) || `Apply modification: ${action}.`);
    console.log("   ▶ iteration prompt:", text);

    // 5) Llamada multi-turn de edición (no “chat”), con temperatura baja
    const it = await openai.responses.create({
      model:       "gpt-4.1-mini",
      temperature: 0.4,
      input: [
        // Recordatorio al modelo de estilo ING
        {
          role: "system",
          content:
            "ING style: accent color #FF6200 sparingly, flat shapes, light-hearted humor, simple geometric forms without strokes, no shadows."
        },
        { role: "user", content: [{ type: "input_text", text }] },
        { type: "image_generation_call", id: imageCallId }
      ],
      tools: [{
        type:       "image_generation",
        background: "transparent",
        size:       "auto",
        quality:    "high"
      }]
    });
    const call2 = it.output.find(o => o.type === "image_generation_call");
    if (!call2?.result) throw new Error("No image returned from iteration");
    console.log("   ✅ iteration generated; new imageCallId=", call2.id);

    // 6) Guardar + subir a S3 (outputs)
    const buf2   = Buffer.from(call2.result, "base64");
    const fname2 = `${Date.now()}.png`;
    const local2 = join(OUTPUT_DIR, fname2);
    await fs.writeFile(local2, buf2);
    const key2   = await uploadToS3(OUTPUT_CFG, local2, fname2);
    console.log("   ✅ iteration uploaded:", key2);

    // 7) Obtener signed URL y responder
    const newUrl = await signedUrl(OUTPUT_CFG.bucket, key2);
    return res.json({
      resultUrl:   newUrl,
      responseId:  it.id,
      imageCallId: call2.id
    });
  } catch (err) {
    console.error("❌ /api/iterate error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// No ruta de descarga directa; el cliente debe usar el signed URL de resultUrl
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
