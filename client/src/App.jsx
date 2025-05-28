import { useRef, useState } from "react";

export default function App() {
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);

  const [captured, setCaptured]       = useState(null);
  const [resultUrl, setResultUrl]     = useState(null);
  const [responseId, setResponseId]   = useState(null);
  const [brandRefs, setBrandRefs]     = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // Estados de despliegue de sub-menus
  const [showColorOpts, setShowColorOpts]   = useState(false);
  const [showScaleOpts, setShowScaleOpts]   = useState(false);
  const [showTextOpts, setShowTextOpts]     = useState(false);

  // Cámara o archivo
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

  // Generación inicial
  async function generate() {
    if (!captured) return alert("Sube o captura una imagen primero");
    setIsGenerating(true);
    const form = new FormData();
    form.append("image", captured, "input.png");
    const res = await fetch("/api/generate", { method: "POST", body: form });
    const data = await res.json();
    setResultUrl(data.resultPath);
    setResponseId(data.responseId);
    setBrandRefs(data.brandRefs || []);
    // Oculta menús
    setShowColorOpts(false);
    setShowScaleOpts(false);
    setShowTextOpts(false);
    setIsGenerating(false);
  }

  // Iteraciones
  async function iterate(action, param) {
    if (!responseId) return alert("Primero genera la imagen inicial");
    setIsGenerating(true);

    // Sugerir título
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
      }
      setIsGenerating(false);
      return;
    }

    // Añadir título libre
    if (action === "add_title" && !param) {
      const userTitle = window.prompt("Escribe el título que quieras añadir:");
      if (!userTitle) { setIsGenerating(false); return; }
      param = userTitle;
    }

    // Llamada de iteración
    const res = await fetch("/api/iterate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previousResponseId: responseId, action, actionParam: param })
    });
    const data = await res.json();
    setResultUrl(data.resultPath);
    setResponseId(data.responseId);
    setIsGenerating(false);

    // Después de iterar, volvemos a esconder sub-menus
    setShowColorOpts(false);
    setShowScaleOpts(false);
    setShowTextOpts(false);
  }

  return (
    <>
      <h1>Taller IA ING – Generador WOW</h1>

      <h2>1. Haz la foto o súbela</h2>
      <video ref={videoRef} autoPlay className="hidden" />
      <canvas ref={canvasRef} className="hidden" />
      <div>
        <button onClick={startCamera}>Usar cámara</button>
        <button onClick={takeShot}>Disparar</button>
        <input type="file" accept="image/*" onChange={onFile} />
      </div>

      {captured && <img src={URL.createObjectURL(captured)} alt="pre" style={{ maxWidth: 400, margin: 8 }} />}

      <div style={{ margin: 8 }}>
        <button onClick={generate} disabled={isGenerating}>
          {isGenerating ? "Generando..." : "Generar estilo ING"}
        </button>
      </div>

      {resultUrl && (
        <>
          <h2>2. Resultado</h2>
          <img src={resultUrl} alt="Resultado" style={{ maxWidth: 600 }} />
          <a href={resultUrl} download="resultado_ing.png">Descargar</a>

          <h3>Referencias usadas:</h3>
          <div style={{ display: "flex", gap: 8 }}>
            {brandRefs.map(ref => (
              <div key={ref.filename} style={{ textAlign: "center" }}>
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
          {isGenerating && <div style={{ marginBottom: 8, fontStyle: "italic" }}>Iterando…</div>}
          {/* Botones principales */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button onClick={() => setShowColorOpts(x => !x)} disabled={isGenerating}>
              Modificar colores
            </button>
            <button onClick={() => setShowScaleOpts(x => !x)} disabled={isGenerating}>
              Modificar escala
            </button>
            <button onClick={() => setShowTextOpts(x => !x)} disabled={isGenerating}>
              Modificar texto
            </button>
            <button onClick={generate} disabled={isGenerating}>
              Rehacer
            </button>
          </div>

          {/* Sub-menus */}
          {showColorOpts && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <button
                onClick={() =>
                  iterate(
                    "change_palette",
                    "#FF6200,#89D6FD,#4D0020,#F689FD"
                  )
                }
                disabled={isGenerating}
              >
                Orange+Sky+Maroon+Blush
              </button>
              <button
                onClick={() =>
                  iterate(
                    "change_palette",
                    "#FF6200,#4D0020,#D40199,#F689FD"
                  )
                }
                disabled={isGenerating}
              >
                Orange+Maroon+Raspberry+Blush
              </button>
              <button
                onClick={() =>
                  iterate(
                    "change_palette",
                    "#FF6200,#D40199,#F689FD,#FFE100"
                  )
                }
                disabled={isGenerating}
              >
                Orange+Raspberry+Blush+Sun
              </button>
              <button
                onClick={() =>
                  iterate(
                    "change_palette",
                    "#FF6200,#7724FF,#89D6FD,#4D0020"
                  )
                }
                disabled={isGenerating}
              >
                Orange+Violet+Sky+Maroon
              </button>
            </div>
          )}

          {showScaleOpts && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <button onClick={() => iterate("resize_up")} disabled={isGenerating}>
                Aumentar
              </button>
              <button onClick={() => iterate("resize_down")} disabled={isGenerating}>
                Disminuir
              </button>
              <button onClick={() => iterate("move_left")} disabled={isGenerating}>
                Mover izquierda
              </button>
              <button onClick={() => iterate("move_right")} disabled={isGenerating}>
                Mover derecha
              </button>
            </div>
          )}

          {showTextOpts && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <button onClick={() => iterate("add_title")} disabled={isGenerating}>
                Añadir título
              </button>
              <button onClick={() => iterate("suggest_title")} disabled={isGenerating}>
                Título con IA
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

