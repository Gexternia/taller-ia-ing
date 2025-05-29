import { useRef, useState } from "react";

export default function App() {
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);

  const [captured, setCaptured]       = useState(null);
  const [resultUrl, setResultUrl]     = useState(null);
  const [responseId, setResponseId]   = useState(null);
  const [brandRefs, setBrandRefs]     = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // --- Cámara / archivo -----------------------------------------------------
  async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    videoRef.current.srcObject = stream;
    videoRef.current.classList.remove("hidden");
  }
  function takeShot() {
    const canvas = canvasRef.current;
    canvas.width  = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d").drawImage(videoRef.current, 0, 0);
    canvas.toBlob(blob => setCaptured(blob), "image/png");
  }
  function onFile(e) {
    setCaptured(e.target.files[0]);
  }

  // --- Generación inicial --------------------------------------------------
  async function generate() {
    if (!captured) {
      alert("Sube o captura una imagen primero");
      return;
    }
    setIsGenerating(true);
    setResultUrl(null);
    setResponseId(null);
    setBrandRefs([]);

    const form = new FormData();
    form.append("image", captured, "input.png");

    const res = await fetch("/api/generate", { method: "POST", body: form });
    const data = await res.json();

    setResultUrl(data.resultUrl);
    setResponseId(data.responseId);
    setBrandRefs(data.brandRefs || []);
    setIsGenerating(false);
  }

  // --- Iteraciones ----------------------------------------------------------
  async function iterate(action, param) {
    if (!responseId) {
      alert("Primero genera la imagen inicial");
      return;
    }
    setIsGenerating(true);

    // Sugerir título con IA
    if (action === "suggest_title") {
      const res = await fetch("/api/iterate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previousResponseId: responseId, action })
      });
      const { suggestedTitle } = await res.json();
      const userTitle = window.prompt("¿Te gusta este título? Si quieres editarlo:", suggestedTitle);
      if (userTitle) {
        await iterate("add_title", userTitle);
      } else {
        setIsGenerating(false);
      }
      return;
    }

    // Añadir título libre
    if (action === "add_title" && !param) {
      const userTitle = window.prompt("Escribe el título que quieras añadir:");
      if (!userTitle) {
        setIsGenerating(false);
        return;
      }
      param = userTitle;
    }

    // Llamada de iteración normal
    const res = await fetch("/api/iterate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previousResponseId: responseId, action, actionParam: param })
    });
    const data = await res.json();

    setResultUrl(data.resultUrl);
    setResponseId(data.responseId);
    setIsGenerating(false);
  }

  return (
    <>
      <h1>Taller IA ING – Generador WOW</h1>

      {/* Paso 1: Foto o subida */}
      <h2>1. Haz la foto o súbela</h2>
      <video ref={videoRef} autoPlay className="hidden" />
      <canvas ref={canvasRef} className="hidden" />
      <div>
        <button onClick={startCamera} disabled={isGenerating}>Usar cámara</button>
        <button onClick={takeShot} disabled={isGenerating}>Disparar</button>
        <input type="file" accept="image/*" onChange={onFile} disabled={isGenerating}/>
      </div>

      {captured && (
        <img
          src={URL.createObjectURL(captured)}
          alt="previsualización"
          style={{ maxWidth: 400, margin: 8 }}
        />
      )}

      {/* Generar */}
      <div style={{ margin: "16px 0" }}>
        <button onClick={generate} disabled={isGenerating}>
          {isGenerating ? "Generando..." : "Generar estilo ING"}
        </button>
      </div>

      {/* Paso 2: Mostrar resultado e iteraciones */}
      {resultUrl && (
        <>
          <h2>2. Resultado</h2>
          <img
            src={resultUrl}
            alt="Resultado"
            style={{ maxWidth: 600, display: "block", marginBottom: 8 }}
          />
          <a href={resultUrl} download="resultado_ing.png">Descargar</a>

          <h3>Referencias usadas:</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {brandRefs.map(ref => (
              <div key={ref.filename || ref.title} style={{ textAlign: "center" }}>
                <img
                  src={ref.url}
                  alt={ref.title}
                  style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 4 }}
                />
                <div style={{ fontSize: 12 }}>{ref.title}</div>
              </div>
            ))}
          </div>

          <h3>3. Iteraciones</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => iterate("change_palette", "Orange (#FF6200), Sky (#89D6FD), Maroon (#4D0020), Blush (#F689FD)")} disabled={isGenerating}>
              Modificar colores
            </button>
            <button onClick={() => iterate("scale_up")}    disabled={isGenerating}>Aumentar escala</button>
            <button onClick={() => iterate("scale_down")}  disabled={isGenerating}>Disminuir escala</button>
            <button onClick={() => iterate("move_left")}   disabled={isGenerating}>Mover izquierda</button>
            <button onClick={() => iterate("move_right")}  disabled={isGenerating}>Mover derecha</button>
            <button onClick={() => iterate("add_title")}   disabled={isGenerating}>Añadir título</button>
            <button onClick={() => iterate("suggest_title")} disabled={isGenerating}>Título con IA</button>
            <button onClick={generate} disabled={isGenerating}>Rehacer</button>
          </div>
          {isGenerating && <p style={{ marginTop: 8 }}>Iterando… por favor espera.</p>}
        </>
      )}
    </>
  );
}


