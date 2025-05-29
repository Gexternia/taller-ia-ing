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

// 1) .env
dotenvConfig();

// 2) Paths temporales
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const UPLOAD_DIR = join(__dirname, "tmp_uploads");
const OUTPUT_DIR = join(__dirname, "tmp_outputs");
await fs.mkdir(UPLOAD_DIR, { recursive: true });
await fs.mkdir(OUTPUT_DIR, { recursive: true });

// 3) S3 buckets
function parseBucket(envVar) {
  const raw = (process.env[envVar]||"")
    .replace(/^s3:\/\//, "")
    .replace(/\/+$/, "");
  const [bucket, ...rest] = raw.split("/");
  return { bucket, prefix: rest.join("/") };
}
const BRAND_CFG  = parseBucket("S3_BUCKET_BRAND_KIT");
const UPLOAD_CFG = parseBucket("S3_BUCKET_UPLOADS");
const OUTPUT_CFG = parseBucket("S3_BUCKET_OUTPUTS");
console.log("✅ S3 buckets:", { BRAND_CFG, UPLOAD_CFG, OUTPUT_CFG });

// 4) Clientes
const s3     = new S3Client({ region: process.env.AWS_REGION });
const openai = new OpenAI({
  apiKey:       process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG
});

// 5) Helpers S3
async function signedUrl(bucket, key) {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}
async function uploadToS3(cfg, localPath, filename) {
  const Body = await fs.readFile(localPath);
  const Key  = cfg.prefix ? `${cfg.prefix}/${filename}` : filename;
  await s3.send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key,
    Body,
    ContentType: mime.lookup(localPath) || "application/octet-stream"
  }));
  return Key;
}

// 6) Leer brand kit
async function listAllIcons() {
  const res = await s3.send(new ListObjectsV2Command({
    Bucket: BRAND_CFG.bucket,
    Prefix: BRAND_CFG.prefix + "/"
  }));
  return (res.Contents||[])
    .filter(o=>/\.(png|jpe?g)$/i.test(o.Key))
    .map(o=>({ key:o.Key, title: basename(o.Key, extname(o.Key)) }));
}

// 7) Embeddings + cosine
function cosineSim(a,b){
  let dot=0, mA=0, mB=0;
  for(let i=0;i<a.length;i++){ dot+=a[i]*b[i]; mA+=a[i]**2; mB+=b[i]**2; }
  return mA&&mB? dot/Math.sqrt(mA*mB):0;
}
async function chooseBrandRefs(desc,k=10){
  const icons = await listAllIcons();
  const titles=icons.map(i=>i.title);
  const [{ data: embs }] = await Promise.all([
    openai.embeddings.create({model:"text-embedding-3-small",input:titles})
  ]);
  const [{ data: descEmb }] = await Promise.all([
    openai.embeddings.create({model:"text-embedding-3-small",input:[desc]})
  ]);
  const descVec=descEmb[0].embedding;
  return embs
    .map((e,i)=>({...icons[i],score:cosineSim(e.embedding,descVec)}))
    .sort((a,b)=>b.score-a.score)
    .slice(0,k);
}

// 8) Data URL
async function imageFileToDataURL(fp){
  const buf=await fs.readFile(fp);
  const t = mime.lookup(fp)||"application/octet-stream";
  return `data:${t};base64,${buf.toString("base64")}`;
}

// 9) Express
const app = express();
app.use(cors());
app.use(express.json());

// Multer
const storage = multer.diskStorage({
  destination:(_r,_f,cb)=>cb(null,UPLOAD_DIR),
  filename:   (_r,f,cb)=>cb(null, Date.now()+extname(f.originalname))
});
const upload = multer({ storage });

/** POST /api/generate */
app.post("/api/generate", upload.single("image"), async (req,res)=>{
  try {
    if(!req.file) return res.status(400).json({error:"No image uploaded"});
    console.log("➡️ /api/generate");

    const vision = await openai.responses.create({
      model:"gpt-4o-mini",
      input:[{
        role:"user",
        content:[
          {type:"input_image",image_url:await imageFileToDataURL(req.file.path)},
          {type:"input_text", text:"Describe what appears in this image (subjects, objects, details), under 600 chars."}
        ]
      }]
    });
    const msg=vision.output[0];
    const description=Array.isArray(msg.content)
      ? msg.content.map(c=>c.text||"").join(" ").trim()
      : typeof msg.content==="string"
        ? msg.content.trim()
        : msg.content.text?.trim()||"";
    console.log("   ▶ desc:",description);

    const refs=await chooseBrandRefs(description,10);
    console.log("   ▶ refs:",refs.map(r=>r.title));

    const refTitles=refs.map(r=>`“${r.title}”`).join(", ");
    const prompt=
      `Generate a flat, vector-based icon of ${description} on a transparent background. `+
      `Follow ING’s illustration style: light-hearted humor, simple geometric shapes without strokes. `+
      `Apply accent color #FF6200 sparingly; use secondary palette for contrast. `+
      `Match these references: ${refTitles}.`;
    console.log("   ▶ prompt:",prompt);

    const gen=await openai.responses.create({
      model:"gpt-4.1-mini",
      input:prompt,
      tools:[{type:"image_generation",background:"transparent",size:"auto",quality:"high"}]
    });
    const call=gen.output.find(o=>o.type==="image_generation_call");
    if(!call?.result)throw new Error("No image returned");
    console.log("   ✅ generated");

    const buf=Buffer.from(call.result,"base64");
    const fname=`${Date.now()}.png`;
    const local=join(OUTPUT_DIR,fname);
    await fs.writeFile(local,buf);
    const s3key=await uploadToS3(OUTPUT_CFG,local,fname);
    console.log("   ✅ uploaded:",s3key);

    const brandRefs=await Promise.all(
      refs.map(async r=>({
        title:r.title,
        url:  await signedUrl(BRAND_CFG.bucket,r.key)
      }))
    );
    return res.json({
      resultUrl:  await signedUrl(OUTPUT_CFG.bucket,s3key),
      brandRefs,
      responseId: gen.id
    });
  } catch(err){
    console.error(err);
    return res.status(500).json({error:err.message});
  }
});

/** POST /api/iterate */
app.post("/api/iterate", async (req,res)=>{
  try {
    const { previousResponseId, action, actionParam }=req.body;
    if(!previousResponseId) return res.status(400).json({error:"Missing previousResponseId"});
    console.log("➡️ /api/iterate",action,actionParam);

    if(action==="suggest_title"){
      const tit=await openai.responses.create({
        model:"gpt-4.1-mini",
        previous_response_id:previousResponseId,
        input:"Suggest a catchy, original title for this illustration."
      });
      const out=tit.output[0];
      const sug=Array.isArray(out.content)
        ? out.content.map(c=>c.text||"").join(" ").trim()
        : typeof out.content==="string"
          ? out.content.trim()
          : out.content.text?.trim()||"";
      return res.json({ suggestedTitle:sug });
    }
    if(action==="add_title"&&!actionParam){
      return res.status(400).json({error:"add_title requires text param"});
    }

    const templates={
      change_palette:p=>`Change color palette to ${p}.`,
      scale_up:      ()=>`Increase the size of the main object.`,
      scale_down:    ()=>`Decrease the size of the main object.`,
      move_left:     ()=>`Move the main object slightly to the left.`,
      move_right:    ()=>`Move the main object slightly to the right.`,
      add_title:p    =>`Add the following title below the image: "${p}".`
    };
    const text=templates[action]?.(actionParam)||`Apply modification: ${action}.`;
    console.log("   ▶ iteration prompt:",text);

    const it=await openai.responses.create({
      model:"gpt-4.1-mini",
      previous_response_id:previousResponseId,
      input:text,
      tools:[{type:"image_generation",background:"transparent",size:"auto",quality:"high"}]
    });
    const call2=it.output.find(o=>o.type==="image_generation_call");
    if(!call2?.result)throw new Error("No image returned");
    console.log("   ✅ iteration gen");

    const buf2=Buffer.from(call2.result,"base64");
    const fname2=`${Date.now()}.png`;
    const local2=join(OUTPUT_DIR,fname2);
    await fs.writeFile(local2,buf2);
    const key2=await uploadToS3(OUTPUT_CFG,local2,fname2);
    console.log("   ✅ iteration uploaded:",key2);

    return res.json({
      resultUrl: await signedUrl(OUTPUT_CFG.bucket,key2),
      responseId: it.id
    });
  } catch(err){
    console.error(err);
    return res.status(500).json({error:err.message});
  }
});

// No download direct
app.get("/api/download/:file",(_req,res)=>
  res.status(404).send("Use signed URL")
);

// 10) Servir frontend
const CLIENT_DIST = join(__dirname, "../client/dist");
app.use(express.static(CLIENT_DIST));
app.get("*", (_req, res) => {
  res.sendFile(join(CLIENT_DIST, "index.html"));
});

// Inicia
const PORT = process.env.PORT||5000;
app.listen(PORT, ()=>console.log(`⚡ API & Front listening on port ${PORT}`));
