import { useRef, useState } from "react";
import "./styles.css";

export default function App() {
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);

  const [captured, setCaptured]         = useState(null);
  const [resultUrl, setResultUrl]       = useState(null);
  const [responseId, setResponseId]     = useState(null);
  const [imageCallId, setImageCallId]   = useState(null);
  const [brandRefs, setBrandRefs]       = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const [originalDescription, setOriginalDescription] = useState("");
  const [prevImageUrl, setPrevImageUrl]               = useState("");
  const [showColorOptions, setShowColorOptions]       = useState(false);
  const [showChatBox, setShowChatBox]                 = useState(false);
  const [showTitleOptions, setShowTitleOptions]       = useState(false);
  const [chatText, setChatText]                       = useState("");
  const [currentScreen, setCurrentScreen]             = useState("welcome");
  const [cameraMode, setCameraMode]                   = useState("idle"); // "idle" | "active"
  const [isCameraOn, setIsCameraOn]                   = useState(false);

  // ==== generate(): envía la imagen a /api/generate y actualiza estados ====
  async function generate() {
    if (!captured) return;

    setIsGenerating(true);
    setCurrentScreen("generating");

    // Preparamos FormData con el archivo
    const form = new FormData();
    form.append("image", captured);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        body: form
      });
      const data = await res.json();

      if (data.error) {
        alert("Error generando ilustración: " + data.error);
        setIsGenerating(false);
        setCurrentScreen("capture");
        return;
      }

      // Actualizamos todos los estados con la respuesta del backend
      setResultUrl(data.resultUrl);
      setBrandRefs(data.brandRefs || []);
      setResponseId(data.responseId);
      setImageCallId(data.imageCallId);
      setOriginalDescription(data.description || "");
      setPrevImageUrl(data.resultUrl);

      // Pasamos a pantalla de resultado
      setCurrentScreen("result");
    } catch (err) {
      console.error("generate error:", err);
      alert("Ha ocurrido un error de red al generar la imagen.");
      setCurrentScreen("capture");
    } finally {
      setIsGenerating(false);
    }
  }

  // ==== Cámara ====

  async function startCamera() {
    if (videoRef.current?.srcObject) stopCamera();
    try {
      const constraints = { video: { facingMode: { ideal: "environment" } }, audio: false };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const video = videoRef.current;
      video.srcObject   = stream;
      video.muted       = true;
      video.playsInline = true;
      await video.play();
      setCameraMode("active");
      setIsCameraOn(true);
    } catch (e) {
      console.error("getUserMedia error:", e);
      const msg = e.name === "NotAllowedError"
        ? "Permiso denegado para la cámara."
        : e.name === "NotFoundError"
        ? "No se encontró cámara disponible."
        : "No se pudo activar la cámara.";
      alert(msg);
      setCameraMode("idle");
      setIsCameraOn(false);
    }
  }

  function takeShot() {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !video.videoWidth) {
      alert("La cámara no está lista.");
      return;
    }
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      setCaptured(blob);
      stopCamera();
    }, "image/png");
  }

  function stopCamera() {
    const video = videoRef.current;
    if (video?.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    setCameraMode("idle");
    setIsCameraOn(false);
  }

  function onFile(e) {
    if (e.target.files[0]) {
      setCaptured(e.target.files[0]);
      stopCamera();
    }
  }

  // ==== Iteraciones ====
  async function iterate(action, param) {
    if (!responseId || !imageCallId) {
      alert("Primero genera la imagen inicial");
      return;
    }
    setIsGenerating(true);

    // payload común
    const payload = {
      previousResponseId: responseId,
      imageCallId,
      action,
      originalDescription: { text: originalDescription, prevImageUrl }
    };
    if (param) payload.actionParam = param;

    try {
      // flujo suggest_title
      if (action === "suggest_title") {
        const res = await fetch("/api/iterate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const { suggestedTitle, error } = await res.json();
        if (error) throw new Error(error);
        const userTitle = window.prompt("¿Te gusta este título? Edítalo si quieres:", suggestedTitle);
        if (userTitle) {
          await iterate("add_title", userTitle);
        }
        return;
      }

      // llamada genérica de iteración
      const res = await fetch("/api/iterate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setResultUrl(data.resultUrl);
      setResponseId(data.responseId);
      setImageCallId(data.imageCallId);
      setPrevImageUrl(data.resultUrl);
      setShowColorOptions(false);
      setShowChatBox(false);
      setShowTitleOptions(false);
      setChatText("");
    } catch (err) {
      console.error("iterate error:", err);
      alert("Error en iteración: " + err.message);
    } finally {
      setIsGenerating(false);
    }
  }

  // ==== Reiniciar ====
  function resetApp() {
    setCaptured(null);
    setResultUrl(null);
    setResponseId(null);
    setImageCallId(null);
    setBrandRefs([]);
    setOriginalDescription("");
    setPrevImageUrl("");
    setShowColorOptions(false);
    setShowChatBox(false);
    setShowTitleOptions(false);
    setChatText("");
    setCurrentScreen("welcome");
    stopCamera();
  }
  // =========================== RENDER PANTALLAS ===========================

  // --- Header fijo ING ---
  const Header = () => (
    <div className="header">
      <div className="logo-container">
        <img src="/images/logo.png" alt="ING Logo" />
      </div>
      <nav>
        <button
          onClick={() => setCurrentScreen("welcome")}
          className={currentScreen === "welcome" ? "active" : ""}
        >
          Home
        </button>
        <button
          onClick={() => setCurrentScreen("capture")}
          className={currentScreen === "capture" ? "active" : ""}
        >
          Capture
        </button>
        <button
          onClick={() => {
            if (resultUrl) setCurrentScreen("result");
            else alert("Primero genera una imagen");
          }}
          className={currentScreen === "result" ? "active" : resultUrl ? "" : "disabled"}
        >
          Iteration
        </button>
        <button
          className="nav-link"
          onClick={() =>
            window.open("https://form.typeform.com/to/Al1mzBDY", "_blank")
          }
        >
          Voting
        </button>
      </nav>
      <button className="reiniciar-btn" onClick={resetApp}>
        Reset
      </button>
    </div>
  );

  // --- Home / Welcome ---
  const WelcomeScreen = () => (
    <div className="welcome-container">
      <Header />
      <div className="welcome-left">
        <h1>
          Your strategy.<br />
          Your style.<br />
          Your illustration.
        </h1>
        <p>
          Transform your ideas into professional illustrations with AI & ING style.
        </p>
        <button className="btn-primary" onClick={() => setCurrentScreen("capture")}>
          Get Started →
        </button>
      </div>
      <div className="welcome-right">
        <img src="/images/nueva-portada.jpg" alt="Team working" />
        <div className="overlay-gradient"></div>
      </div>
    </div>
  );

  // --- Capture ---
  const CaptureScreen = () => (
    <div className="capture-container">
      <Header />

      {/* IZQUIERDA (naranja, con dos zonas: texto arriba, foto abajo) */}
      <div className="capture-left" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: "2.5rem", marginBottom: "1rem", marginTop: "2rem" }}>
            Capture Your<br />Strategy
          </h1>
          <p style={{ fontSize: "1.18rem", fontWeight: 500 }}>
            Take a photo or upload your sketch.<br />
            <span style={{ fontSize: "1rem", color: "#ffd6c2", fontWeight: 400 }}>
              You will get an ING-style illustration!
            </span>
          </p>
        </div>
        <div style={{ marginBottom: "1.5rem", marginTop: "2rem" }}>
          <img
            src="/images/foto2.jpg"
            alt="Ejemplo ING"
            style={{
              width: "95%",
              maxWidth: "320px",
              borderRadius: "1.2rem",
              boxShadow: "0 2px 16px rgba(60,0,0,0.08)",
              border: "3px solid #fff6",
              marginLeft: "auto",
              marginRight: "auto",
              display: "block"
            }}
          />
        </div>
      </div>

      {/* DERECHA */}
      <div className="capture-right">

        {/* --- Botón cámara corporativo ING --- */}
        <div className="camera-controls" style={{ marginTop: "1.5rem", marginBottom: "1.5rem", justifyContent: "flex-start" }}>
          <button
            className="btn-primary"
            style={{ minWidth: "180px", fontSize: "1.1rem" }}
            onClick={() => {
              if (cameraMode === "idle") startCamera();
              else takeShot();
            }}
            disabled={isGenerating}
          >
            {cameraMode === "idle" ? "Activate Camera" : "Capture"}
          </button>
        </div>
        
        {/* --- Preview de cámara, siempre montado pero oculto hasta estar activo --- */}
 <div className="video-preview">
   <video
    ref={videoRef}
   autoPlay
    playsInline
     muted
     className="camera-preview"
     style={{
     width: "100%",
      borderRadius: "0.75rem",
      marginBottom: "1rem",
     display: cameraMode === "active" ? "block" : "none"
    }}
   />
   <canvas ref={canvasRef} className="hidden" />
 </div>

        {/* --- Upload section --- */}
        <div className="upload-section">
          <label className="upload-btn" htmlFor="file-upload" style={{ fontSize: "1.15rem", border: "2px dashed #FF6200" }}>
            Upload Image
            <input id="file-upload" type="file" accept="image/*" onChange={onFile} hidden disabled={isGenerating} />
          </label>
        </div>

        {/* --- Preview de imagen subida/capturada --- */}
        {captured && (
          <div className="preview-box" style={{ marginBottom: "1.5rem" }}>
            <img src={URL.createObjectURL(captured)} alt="Preview" />
          </div>
        )}

        <button
          className="btn-primary"
          style={{ width: "100%", fontSize: "1.11rem", marginTop: "1rem" }}
          onClick={generate}
          disabled={!captured || isGenerating}
        >
          {isGenerating ? "Generating..." : "Generate Illustration"}
        </button>
      </div>
    </div>
  );

  // --- Generating (pantalla intermedia, sin cambios) ---
  const GeneratingScreen = () => (
    <div className="generating-container">
      <Header />
      <div className="spinner"></div>
      <h2>Generating your illustration…</h2>
      <p>We’re analyzing and applying ING’s style.</p>
    </div>
  );

  // --- Pantalla Resultado + Personalización (Iteration) ---
  const ResultScreen = () => (
    <div style={{
      display: "flex",
      minHeight: "100vh",
      backgroundColor: "#F7F7F7",
      padding: "2rem",
      gap: "2rem"
    }}>
      <Header />

      {/* IZQUIERDA: imagen y refs */}
      <div style={{ flex: 2, display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{
          background: "#ffffff",
          borderRadius: "1rem",
          boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
          overflow: "hidden",
          position: "relative"
        }}>
          <div style={{
            borderBottom: "1px solid #ECECEC",
            padding: "1rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#333333" }}>
              Your ING Illustration
            </h2>
            <a
              href={resultUrl}
              download="ilustracion_ing.png"
              style={{
                backgroundColor: "#FF6200",
                color: "#ffffff",
                padding: "0.75rem 1.25rem",
                borderRadius: "0.75rem",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                textDecoration: "none"
              }}
            >
              Download
            </a>
          </div>
          <div style={{ background: "#F7F7F7", padding: "1rem", display: "flex", justifyContent: "center" }}>
            <img
              src={resultUrl}
              alt="Ilustración generada"
              style={{ width: "100%", borderRadius: "0.75rem", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}
            />
          </div>
        </div>
        {/* Referencias */}
        {brandRefs.length > 0 && (
          <div style={{
            background: "#ffffff",
            borderRadius: "1rem",
            boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
            padding: "1rem"
          }}>
            <h3 style={{ fontSize: "1.125rem", fontWeight: 600, color: "#333333", marginBottom: "0.75rem" }}>
              References
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(4rem, 1fr))", gap: "0.75rem" }}>
              {brandRefs.map((ref, index) => (
                <div key={index} style={{ textAlign: "center" }}>
                  <img
                    src={ref.url}
                    alt={ref.title}
                    style={{ width: "100%", height: "4rem", objectFit: "cover", borderRadius: "0.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}
                  />
                  <p style={{
                    fontSize: "0.75rem",
                    color: "#666666",
                    marginTop: "0.5rem",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}>
                    {ref.title}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* DERECHA: Personalización */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{
          background: "#ffffff",
          borderRadius: "1rem",
          boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
          padding: "1rem"
        }}>
          <h3 style={{ fontSize: "1.125rem", fontWeight: 600, color: "#333333", marginBottom: "0.75rem" }}>
            Personalization
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <button
              onClick={() => {
                setShowColorOptions(!showColorOptions);
                setShowChatBox(false);
                setShowTitleOptions(false);
              }}
              disabled={isGenerating}
              style={{
                display: "flex",
                alignItems: "center",
                background: "#F7F7F7",
                borderRadius: "0.75rem",
                padding: "0.75rem",
                gap: "0.75rem",
                cursor: isGenerating ? "not-allowed" : "pointer",
                opacity: isGenerating ? 0.5 : 1,
                border: "none"
              }}
            >
              <div style={{
                width: "2.5rem",
                height: "2.5rem",
                background: "linear-gradient(to right, #FF6200, #A855F7)",
                borderRadius: "0.5rem"
              }}></div>
              <div>
                <p style={{ fontWeight: 600, color: "#333333" }}>Change Colors</p>
                <p style={{ fontSize: "0.875rem", color: "#777777" }}>ING palettes</p>
              </div>
            </button>

            <button
              onClick={() => {
                setShowTitleOptions(!showTitleOptions);
                setShowColorOptions(false);
                setShowChatBox(false);
              }}
              disabled={isGenerating}
              style={{
                display: "flex",
                alignItems: "center",
                background: "#F7F7F7",
                borderRadius: "0.75rem",
                padding: "0.75rem",
                gap: "0.75rem",
                cursor: isGenerating ? "not-allowed" : "pointer",
                opacity: isGenerating ? 0.5 : 1,
                border: "none"
              }}
            >
              <div style={{
                width: "2.5rem",
                height: "2.5rem",
                background: "#EDE9FE",
                borderRadius: "0.5rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}>
                <svg style={{ width: "1.25rem", height: "1.25rem", color: "#7C3AED" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2m-9 0h10a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2z" />
                </svg>
              </div>
              <div>
                <p style={{ fontWeight: 600, color: "#333333" }}>Add Title</p>
                <p style={{ fontSize: "0.875rem", color: "#777777" }}>Custom text</p>
              </div>
            </button>

            <button
              onClick={() => {
                setShowChatBox(!showChatBox);
                setShowColorOptions(false);
                setShowTitleOptions(false);
              }}
              disabled={isGenerating}
              style={{
                display: "flex",
                alignItems: "center",
                background: "#F7F7F7",
                borderRadius: "0.75rem",
                padding: "0.75rem",
                gap: "0.75rem",
                cursor: isGenerating ? "not-allowed" : "pointer",
                opacity: isGenerating ? 0.5 : 1,
                border: "none"
              }}
            >
              <div style={{
                width: "2.5rem",
                height: "2.5rem",
                background: "#E0F2FE",
                borderRadius: "0.5rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}>
                <svg style={{ width: "1.25rem", height: "1.25rem", color: "#0284C7" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div>
                <p style={{ fontWeight: 600, color: "#333333" }}>Modify with AI</p>
                <p style={{ fontSize: "0.875rem", color: "#777777" }}>Custom instructions</p>
              </div>
            </button>
          </div>

          {/* Sub-menú Change colors */}
          {showColorOptions && (
            <div style={{
              marginTop: "1rem",
              background: "#F7F7F7",
              borderRadius: "1rem",
              padding: "1rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem"
            }}>
              <p style={{ fontWeight: 600, color: "#333333", marginBottom: "0.5rem" }}>Palettes</p>
              {[
                { name: "Orange + Sky + Maroon + Blush", colors: ["#FF6200", "#89D6FD", "#4D0020", "#F689FD"] },
                { name: "Orange + Maroon + Raspberry + Blush", colors: ["#FF6200", "#4D0020", "#D40199", "#F689FD"] },
                { name: "Orange + Raspberry + Blush + Sun", colors: ["#FF6200", "#D40199", "#F689FD", "#FFE100"] },
                { name: "Orange + Violet + Sky + Maroon", colors: ["#FF6200", "#7724FF", "#89D6FD", "#4D0020"] }
              ].map((palette, idx) => (
                <button
                  key={idx}
                  onClick={() => iterate("change_palette", palette.colors.join(", "))}
                  disabled={isGenerating}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    background: "#ffffff",
                    borderRadius: "0.5rem",
                    padding: "0.75rem",
                    gap: "0.75rem",
                    border: "1px solid #E5E7EB",
                    cursor: isGenerating ? "not-allowed" : "pointer",
                    opacity: isGenerating ? 0.5 : 1
                  }}
                >
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    {palette.colors.map((c, i) => (
                      <span key={i} style={{
                        width: "1rem",
                        height: "1rem",
                        background: c,
                        borderRadius: "9999px"
                      }}></span>
                    ))}
                  </div>
                  <span style={{
                    fontSize: "0.875rem",
                    color: "#555555",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}>
                    {palette.name}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Sub-menú Title */}
          {showTitleOptions && (
            <div style={{
              marginTop: "1rem",
              background: "#F7F7F7",
              borderRadius: "1rem",
              padding: "1rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem"
            }}>
              <p style={{ fontWeight: 600, color: "#333333", marginBottom: "0.5rem" }}>Title options</p>
              <button
                onClick={() => iterate("add_title")}
                disabled={isGenerating}
                style={{
                  background: "#ffffff",
                  borderRadius: "0.5rem",
                  padding: "0.75rem",
                  textAlign: "left",
                  border: "1px solid #E5E7EB",
                  cursor: isGenerating ? "not-allowed" : "pointer",
                  opacity: isGenerating ? 0.5 : 1
                }}
              >
                Custom Title
              </button>
              <button
                onClick={() => iterate("suggest_title")}
                disabled={isGenerating}
                style={{
                  background: "#ffffff",
                  borderRadius: "0.5rem",
                  padding: "0.75rem",
                  textAlign: "left",
                  border: "1px solid #E5E7EB",
                  cursor: isGenerating ? "not-allowed" : "pointer",
                  opacity: isGenerating ? 0.5 : 1
                }}
              >
                AI-generated Title
              </button>
            </div>
          )}

          {/* Sub-menú Modify AI */}
          {showChatBox && (
            <div style={{
              marginTop: "1rem",
              background: "#F7F7F7",
              borderRadius: "1rem",
              padding: "1rem"
            }}>
              <p style={{ fontWeight: 600, color: "#333333", marginBottom: "0.5rem" }}>Modify with AI</p>
              <textarea
                rows={3}
                maxLength={250}
                placeholder="Describe the changes you want to apply…"
                value={chatText}
                onChange={e => setChatText(e.target.value)}
                disabled={isGenerating}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  borderRadius: "0.5rem",
                  border: "1px solid #E5E7EB",
                  resize: "none",
                  fontFamily: "inherit",
                  marginBottom: "0.5rem"
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.75rem", color: "#777777" }}>{chatText.length}/250 chars</span>
                <button
                  onClick={() => {
                    iterate("chat", chatText);
                    setShowChatBox(false);
                    setChatText("");
                  }}
                  disabled={isGenerating || !chatText.trim()}
                  style={{
                    background: "#0284C7",
                    color: "#ffffff",
                    padding: "0.5rem 1rem",
                    borderRadius: "0.5rem",
                    cursor: (isGenerating || !chatText.trim()) ? "not-allowed" : "pointer",
                    opacity: (isGenerating || !chatText.trim()) ? 0.5 : 1
                  }}
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>
        {/* Botón Regenerar */}
        <div style={{
          background: "#ffffff",
          borderRadius: "1rem",
          boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
          padding: "1rem"
        }}>
          <h3 style={{ fontSize: "1.125rem", fontWeight: 600, color: "#333333", marginBottom: "0.75rem" }}>
            Actions
          </h3>
          <button
            onClick={generate}
            disabled={isGenerating}
            style={{
              background: "#FF6200",
              color: "#ffffff",
              width: "100%",
              padding: "0.75rem",
              borderRadius: "0.75rem",
              fontWeight: 600,
              cursor: isGenerating ? "not-allowed" : "pointer",
              opacity: isGenerating ? 0.5 : 1
            }}
          >
            Regenerate Image
          </button>
        </div>
        {isGenerating && (
          <div style={{
            background: "#FFF8E1",
            borderRadius: "1rem",
            boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
            padding: "1rem",
            display: "flex",
            alignItems: "center",
            gap: "1rem"
          }}>
            <div style={{
              width: "1.5rem",
              height: "1.5rem",
              border: "0.25rem solid #FF6200",
              borderTopColor: "transparent",
              borderRadius: "9999px",
              animation: "spin 1s infinite linear"
            }}></div>
            <div>
              <span style={{ fontWeight: 600, color: "#FF8A00" }}>Processing…</span>
              <p style={{ fontSize: "0.875rem", color: "#FF8A00", marginTop: "0.25rem" }}>
                Applying changes, please wait.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // --- Switch de pantallas ---
  if (currentScreen === "welcome") return <WelcomeScreen />;
  if (currentScreen === "capture") return <CaptureScreen />;
  if (currentScreen === "generating") return <GeneratingScreen />;
  if (currentScreen === "result") return <ResultScreen />;

  return <WelcomeScreen />;
}