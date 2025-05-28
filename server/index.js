import express from "express";
import multer from "multer";
import { fileURLToPath } from "url";
import { dirname, join, extname, basename } from "path";
import { config as dotenvConfig } from "dotenv";
import fs from "fs/promises";
import mime from "mime-types";
import OpenAI, { toFile } from "openai";

// Carga .env
dotenvConfig();

// Paths
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const STATIC_DIR = join(__dirname, "..", "static");
const UPLOAD_DIR = join(STATIC_DIR, "uploads");
const OUTPUT_DIR = join(STATIC_DIR, "outputs");
const BRAND_DIR  = join(STATIC_DIR, "brand_kit");

// Asegura carpetas
await fs.mkdir(UPLOAD_DIR, { recursive: true });
await fs.mkdir(OUTPUT_DIR, { recursive: true });

// Cliente OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG
});

// Helper: convierte imagen a Data URL base64
async function imageFileToDataURL(filePath) {
  const buffer   = await fs.readFile(filePath);
  const mimeType = mime.lookup(filePath) || "application/octet-stream";
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

// Cosine similarity para embeddings
function cosineSim(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return magA && magB ? dot / Math.sqrt(magA * magA * magB * magB) : 0;
}

// Lista todos los iconos del brand kit
async function listAllIcons() {
  const files = await fs.readdir(BRAND_DIR);
  return files
    .filter(f => /\.(png|jpe?g)$/i.test(f))
    .map(f => ({ path: join(BRAND_DIR, f), title: basename(f, extname(f)) }));
}

// Elige las k referencias más afines según embedding
async function chooseBrandRefs(description, k = 10) {
  const icons  = await listAllIcons();
  const titles = icons.map(i => i.title);
  const { data: embs }    = await openai.embeddings.create({
    model: "text-embedding-3-small", input: titles
  });
  const { data: descEmb } = await openai.embeddings.create({
    model: "text-embedding-3-small", input: [description]
  });
  const descVec = descEmb[0].embedding;
  const scored  = embs.map((e, i) => ({
    ...icons[i],
    score: cosineSim(e.embedding, descVec)
  }));
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ path, title }) => ({ path, title }));
}

const app = express();
app.use(express.json());
app.use("/static", express.static(STATIC_DIR));

// Multer para subidas
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => cb(null, Date.now() + extname(file.originalname))
});
const upload = multer({ storage });

/**
 * 1) Generación inicial
 */
app.post("/api/generate", upload.single("image"), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ error: "No image uploaded" });

    // Extrae descripción
    const inputImage = req.file.path;
    const visionResp = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [{
        role: "user",
        content: [
          { type: "input_image", image_url: await imageFileToDataURL(inputImage) },
          { type: "input_text",  text: "Describe what appears in this image (subjects, objects, details), do not focus in the materials used, in fewer than 600 characters." }
        ]
      }]
    });
    const msg = visionResp.output[0];
    const description = Array.isArray(msg.content)
      ? msg.content.map(c => c.text || "").join(" ").trim()
      : typeof msg.content === "string"
        ? msg.content.trim()
        : msg.content.text?.trim() || "";
    console.log("➡️ Descripción extraída:", description);

    // Selecciona 10 referencias
    const refs = await chooseBrandRefs(description, 10);
    console.log("➡️ Referencias seleccionadas:", refs.map(r => r.title));

    // Construye prompt
    const refTitles = refs.map(r => `“${r.title}”`).join(", ");
    const prompt =
      `Generate a flat, vector-based icon of ${description} on a transparent background. ` +
      `Follow ING’s illustration style: light-hearted humor, simple geometric shapes without strokes, subtle unique details. ` +
      `Apply accent color #FF6200 sparingly and use secondary palette colors for contrast. ` +
      `Match exactly the style of these reference icons: ${refTitles}. ` +
      `Maintain only basic shapes, clean colors, avoid extra details.`;
    console.log("➡️ Prompt inicial:", prompt);

    // Llamada a Responses API (generación)
    const genResp = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
      tools: [{
        type:       "image_generation",
        background: "transparent",
        size:       "auto",
        quality:    "high"
      }]
    });

    // Extrae y guarda imagen
    const call = genResp.output.find(o => o.type === "image_generation_call");
    if (!call?.result) throw new Error("No image returned");
    const buffer   = Buffer.from(call.result, "base64");
    const filename = `${Date.now()}.png`;
    await fs.writeFile(join(OUTPUT_DIR, filename), buffer);

    // Responde con ruta, referencias y responseId
    res.json({
      resultPath: `/static/outputs/${filename}`,
      brandRefs: refs.map(r => ({
        url:      `/static/brand_kit/${basename(r.path)}`,
        title:    r.title,
        filename: basename(r.path)
      })),
      responseId: genResp.id
    });

  } catch (err) {
    console.error("❌ Error en /api/generate:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 2) Iteraciones
 */
app.post("/api/iterate", async (req, res) => {
  try {
    const { previousResponseId, action, actionParam } = req.body;
    if (!previousResponseId)
      return res.status(400).json({ error: "Missing previousResponseId" });

    // 1) Sugerir título con IA
    if (action === "suggest_title") {
      console.log("➡️ Generando título con IA…");
      const titleResp = await openai.responses.create({
        model:                "gpt-4.1-mini",
        previous_response_id: previousResponseId,
        input:                "Suggest a catchy, original title for this illustration."
      });
      const out = titleResp.output[0];
      const suggested = Array.isArray(out.content)
        ? out.content.map(c => c.text || "").join(" ").trim()
        : typeof out.content === "string"
          ? out.content.trim()
          : out.content.text?.trim() || "";
      return res.json({ suggestedTitle: suggested });
    }

    // 2) Validar add_title
    if (action === "add_title" && !actionParam) {
      return res.status(400).json({ error: "add_title requires a text parameter" });
    }

    // 3) Mapear acciones a prompt de iteración
    const templates = {
      change_palette: param => `Change color palette to ${param}.`,
      resize_up:      ()    => `Increase the size of the main object.`,
      resize_down:    ()    => `Decrease the size of the main object.`,
      move_left:      ()    => `Move the main object slightly to the left.`,
      move_right:     ()    => `Move the main object slightly to the right.`,
      add_title:      param => `Add the following title below the image: "${param}".`
    };
    const text = templates[action]?.(actionParam)
      || `Apply modification: ${action}.`;
    console.log("➡️ Iteration prompt:", text);

    // 4) Llamada multi-turn image_generation
    const iterResp = await openai.responses.create({
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

    // 5) Extrae y guarda nueva imagen
    const call2 = iterResp.output.find(o => o.type === "image_generation_call");
    if (!call2?.result) throw new Error("No image returned");
    const buf2  = Buffer.from(call2.result, "base64");
    const file2 = `${Date.now()}.png`;
    await fs.writeFile(join(OUTPUT_DIR, file2), buf2);

    res.json({
      resultPath: `/static/outputs/${file2}`,
      responseId: iterResp.id
    });

  } catch (err) {
    console.error("❌ Error en /api/iterate:", err);
    res.status(500).json({ error: err.message });
  }
});

// 3) Endpoint de descarga
app.get("/api/download/:file", (req, res) => {
  const file     = req.params.file;
  const fullPath = join(OUTPUT_DIR, file);
  if (!fullPath.startsWith(OUTPUT_DIR)) return res.sendStatus(403);
  res
    .type(mime.lookup(fullPath) || "application/octet-stream")
    .download(fullPath);
});

// Inicia servidor
const PORT = 5000;
app.listen(PORT, () =>
  console.log(`⚡ API listening on http://localhost:${PORT}`)
);

