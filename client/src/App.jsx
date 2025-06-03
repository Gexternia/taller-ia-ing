import { useRef, useState } from "react";

export default function App() {
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);

  const [captured, setCaptured]         = useState(null);
  const [resultUrl, setResultUrl]       = useState(null);
  const [responseId, setResponseId]     = useState(null);
  const [imageCallId, setImageCallId]   = useState(null);
  const [brandRefs, setBrandRefs]       = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // Guardamos la descripción original y la URL de la imagen para pasárselas al “chat”
  const [originalDescription, setOriginalDescription] = useState("");
  const [prevImageUrl, setPrevImageUrl]               = useState("");

  // Control de sub‐menús
  const [showColorOptions, setShowColorOptions]   = useState(false);
  const [showChatBox, setShowChatBox]             = useState(false);
  const [showTitleOptions, setShowTitleOptions]   = useState(false);
  const [chatText, setChatText]                   = useState("");

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

    // Limpiar todos los estados de iteración
    setResultUrl(null);
    setResponseId(null);
    setImageCallId(null);
    setBrandRefs([]);
    setShowColorOptions(false);
    setShowChatBox(false);
    setShowTitleOptions(false);
    setOriginalDescription("");
    setPrevImageUrl("");

    const form = new FormData();
    form.append("image", captured, "input.png");

    const res  = await fetch("/api/generate", { method: "POST", body: form });
    const data = await res.json();

    if (data.error) {
      alert("Error al generar: " + data.error);
      setIsGenerating(false);
      return;
    }

    setResultUrl(data.resultUrl);
    setResponseId(data.responseId);
    setImageCallId(data.imageCallId);
    setBrandRefs(data.brandRefs || []);
    setOriginalDescription(data.description || "");
    setPrevImageUrl(data.resultUrl); // Guardamos la URL de la imagen inicial
    setIsGenerating(false);
  }

  // --- Iteraciones ----------------------------------------------------------
  async function iterate(action, param) {
    console.log("Payload originalDescription:", originalDescription);
    if (!responseId || !imageCallId) {
      alert("Primero genera la imagen inicial");
      return;
    }
    setIsGenerating(true);

    // 1) Sugerir título con IA
    if (action === "suggest_title") {
      const res = await fetch("/api/iterate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previousResponseId: responseId,
          imageCallId,
          action,
          originalDescription: { text: originalDescription, prevImageUrl }
        })
      });
      const { suggestedTitle, error } = await res.json();
      if (error) {
        alert("Error: " + error);
        setIsGenerating(false);
        return;
      }
      const userTitle = window.prompt(
        "¿Te gusta este título? Si quieres editarlo:",
        suggestedTitle
      );
      if (userTitle) {
        await iterate("add_title", userTitle);
      } else {
        setIsGenerating(false);
      }
      return;
    }

    // 2) Añadir título libre
    if (action === "add_title" && !param) {
      const userTitle = window.prompt("Escribe el título que quieras añadir:");
      if (!userTitle) {
        setIsGenerating(false);
        return;
      }
      param = userTitle;
    }

    // 3) Modificación vía chat (action === "chat")
    if (action === "chat" && !param) {
      alert("Escribe algo en el cuadro de chat antes de enviar");
      setIsGenerating(false);
      return;
    }

    // 4) Llamada de iteración normal (o chat)
    const payload = {
      previousResponseId: responseId,
      imageCallId,
      action,
      originalDescription: { text: originalDescription, prevImageUrl }
    };
    if (param) payload.actionParam = param;

    const res = await fetch("/api/iterate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.error) {
      alert("Error en iteración: " + data.error);
      setIsGenerating(false);
      return;
    }

    // Actualizar con la nueva URL y guardar para la próxima iteración
    setResultUrl(data.resultUrl);
    setResponseId(data.responseId);
    setImageCallId(data.imageCallId);
    setPrevImageUrl(data.resultUrl);
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
        <button onClick={takeShot}    disabled={isGenerating}>Disparar</button>
        <input type="file" accept="image/*" onChange={onFile} disabled={isGenerating} />
      </div>

      {captured && (
        <img
          src={URL.createObjectURL(captured)}
          alt="previsualización"
          style={{ maxWidth: 400, margin: 8 }}
        />
      )}

      {/* Botón Generar */}
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
            {brandRefs.map((ref) => (
              <div key={ref.title} style={{ textAlign: "center" }}>
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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {/* Botón 1: Modificar colores */}
            <button
              onClick={() => {
                setShowColorOptions(!showColorOptions);
                setShowChatBox(false);
                setShowTitleOptions(false);
              }}
              disabled={isGenerating}
            >
              Modificar colores
            </button>

            {/* Botón 2: Modificar vía chat */}
            <button
              onClick={() => {
                setShowChatBox(!showChatBox);
                setShowColorOptions(false);
                setShowTitleOptions(false);
              }}
              disabled={isGenerating}
            >
              Modificar vía chat
            </button>

            {/* Botón 3: Modificar título */}
            <button
              onClick={() => {
                setShowTitleOptions(!showTitleOptions);
                setShowColorOptions(false);
                setShowChatBox(false);
              }}
              disabled={isGenerating}
            >
              Modificar título
            </button>

            {/* Botón 4: Volver a generar */}
            <button onClick={generate} disabled={isGenerating}>
              Volver a generar
            </button>
          </div>

          {/* Sub‐menú “Modificar colores” (4 opciones hexadecimales) */}
          {showColorOptions && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              <button
                onClick={() =>
                  iterate(
                    "change_palette",
                    "Orange (#FF6200), Sky (#89D6FD), Maroon (#4D0020), Blush (#F689FD)"
                  )
                }
                disabled={isGenerating}
              >
                Orange + Sky + Maroon + Blush
              </button>

              <button
                onClick={() =>
                  iterate(
                    "change_palette",
                    "Orange (#FF6200), Maroon (#4D0020), Raspberry (#D40199), Blush (#F689FD)"
                  )
                }
                disabled={isGenerating}
              >
                Orange + Maroon + Raspberry + Blush
              </button>

              <button
                onClick={() =>
                  iterate(
                    "change_palette",
                    "Orange (#FF6200), Raspberry (#D40199), Blush (#F689FD), Sun (#FFE100)"
                  )
                }
                disabled={isGenerating}
              >
                Orange + Raspberry + Blush + Sun
              </button>

              <button
                onClick={() =>
                  iterate(
                    "change_palette",
                    "Orange (#FF6200), Violet (#7724FF), Sky (#89D6FD), Maroon (#4D0020)"
                  )
                }
                disabled={isGenerating}
              >
                Orange + Violet + Sky + Maroon
              </button>
            </div>
          )}

          {/* Sub‐menú “Modificar vía chat” (input + enviar) */}
          {showChatBox && (
            <div style={{ marginBottom: 16 }}>
              <textarea
                rows={3}
                maxLength={250}  // límite en frontend para no enviar textos demasiado largos
                style={{ width: "100%", marginBottom: 8 }}
                placeholder="Escribe aquí la modificación que quieras aplicar..."
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                disabled={isGenerating}
              />
              <button
                onClick={() => {
                  iterate("chat", chatText);
                  setShowChatBox(false);
                  setChatText("");
                }}
                disabled={isGenerating || !chatText.trim()}
              >
                Enviar modificación
              </button>
              <div style={{ fontSize: 12, color: "#666" }}>
                ({chatText.length}/250 caracteres)
              </div>
            </div>
          )}

          {/* Sub‐menú “Modificar título” (2 opciones) */}
          {showTitleOptions && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              <button
                onClick={() => iterate("add_title")}
                disabled={isGenerating}
              >
                Añadir un título
              </button>
              <button
                onClick={() => iterate("suggest_title")}
                disabled={isGenerating}
              >
                Título con IA
              </button>
            </div>
          )}

          {isGenerating && (
            <p style={{ marginTop: 8, fontStyle: "italic" }}>
              Iterando… por favor, espera.
            </p>
          )}
        </>
      )}
    </>
  );
}
