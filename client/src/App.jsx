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

  // ==== Cámara ====

  async function startCamera() {
    if (videoRef.current?.srcObject) {
      stopCamera();
    }
    try {
      const constraints = {
        video: { facingMode: { ideal: "environment" } },
        audio: false
      };
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
      if (e.name === "NotAllowedError") {
        alert("Permiso denegado para acceder a la cámara. Actívalo en la configuración del navegador.");
      } else if (e.name === "NotFoundError" || e.name === "OverconstrainedError") {
        alert("No se encontró cámara disponible o está siendo usada por otra app.");
      } else {
        alert("No se pudo activar la cámara. Prueba cerrar otras apps o revisa permisos del navegador.");
      }
      setCameraMode("idle");
      setIsCameraOn(false);
    }
  }

  function takeShot() {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      alert("La cámara no está lista todavía. Espera un momento.");
      return;
    }
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    canvas.toBlob(blob => {
      setCaptured(blob);
      stopCamera();
    }, "image/png");
  }

  function stopCamera() {
    const video = videoRef.current;
    if (video?.srcObject) {
      video.srcObject.getTracks().forEach(track => track.stop());
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

  // ==== Generación ====

  async function generate() {
    if (!captured) {
      alert("Sube o captura una imagen primero");
      return;
    }
    setIsGenerating(true);
    setCurrentScreen("generating");

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
      setCurrentScreen("capture");
      return;
    }

    setResultUrl(data.resultUrl);
    setResponseId(data.responseId);
    setImageCallId(data.imageCallId);
    setBrandRefs(data.brandRefs || []);
    setOriginalDescription(data.description || "");
    setPrevImageUrl(data.resultUrl);
    setIsGenerating(false);
    setCurrentScreen("result");
  }

  // ==== Iteraciones ====

  async function iterate(action, param) {
    if (!responseId || !imageCallId) {
      alert("Primero genera la imagen inicial");
      return;
    }
    setIsGenerating(true);

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
      const userTitle = window.prompt("¿Te gusta este título? Si quieres editarlo:", suggestedTitle);
      if (userTitle) {
        await iterate("add_title", userTitle);
      } else {
        setIsGenerating(false);
      }
      return;
    }

    if (action === "add_title" && !param) {
      const userTitle = window.prompt("Escribe el título que quieras añadir:");
      if (!userTitle) {
        setIsGenerating(false);
        return;
      }
      param = userTitle;
    }

    if (action === "chat" && !param) {
      alert("Escribe algo en el cuadro de chat antes de enviar");
      setIsGenerating(false);
      return;
    }

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

    setResultUrl(data.resultUrl);
    setResponseId(data.responseId);
    setImageCallId(data.imageCallId);
    setPrevImageUrl(data.resultUrl);
    setIsGenerating(false);

    setShowColorOptions(false);
    setShowChatBox(false);
    setShowTitleOptions(false);
    setChatText("");
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

  const Header = () => (
    <div className="header">
      <div className="logo-container">
        <img src="/images/logo.png" alt="ING Logo" />
      </div>
      <nav>
        <button onClick={() => setCurrentScreen("welcome")} className={currentScreen === "welcome" ? "active" : ""}>
          Home
        </button>
        <button onClick={() => setCurrentScreen("capture")} className={currentScreen === "capture" ? "active" : ""}>
          Capture
        </button>
        <button
          onClick={() => {
            if (resultUrl) setCurrentScreen("result");
            else alert("Primero genera una imagen");
          }}
          className={currentScreen === "result" ? "active" : resultUrl ? "" : "disabled"}>
          Iteration
        </button>
        <button className="nav-link" onClick={() => window.open("https://form.typeform.com/to/Al1mzBDY", "_blank")}>
          Voting
        </button>
      </nav>
      <button className="reiniciar-btn" onClick={resetApp}>
        Reset
      </button>
    </div>
  );

  const WelcomeScreen = () => (
    <div className="welcome-container">
      <Header />
      <div className="welcome-left">
        <h1>
          Your strategy.<br />
          Your style.<br />
          Your illustration.
        </h1>
        <p>Transform your ideas into professional illustrations with AI & ING style.</p>
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

  const CaptureScreen = () => (
    <div className="capture-container">
      <Header />
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
      <div className="capture-right">
        <div className="camera-controls" style={{ marginTop: "1.5rem", marginBottom: "1.5rem", justifyContent: "flex-start" }}>
          <button
            className="btn_PRIMARY"
            style={{ minWidth: "180px", fontSize: "1.1rem" }}
            onClick={() => {
              if (cameraMode === "idle") startCamera();
              else takeShot();
            }}
            disabled={isGenerating}>
            {cameraMode === "idle" ? "Activate Camera" : "Capture"}
          </button>
        </div>
        {cameraMode === "active" && (
          <div className="video-preview">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="camera-preview"
              style={{ width: "100%", borderRadius: "0.75rem", marginBottom: "1rem" }}
            />
            <canvas ref={canvasRef} className="hidden" />
          </div>
        )}
        <div className="upload-section">
          <label className="upload-btn" htmlFor="file-upload" style={{ fontSize: "1.15rem", border: "2px dashed #FF6200" }}>
            Upload Image
            <input id="file-upload" type="file" accept="image/*" onChange={onFile} hidden disabled={isGenerating} />
          </label>
        </div>
        {captured && (
          <div className="preview-box" style={{ marginBottom: "1.5rem" }}>
            <img src={URL.createObjectURL(captured)} alt="Preview" />
          </div>
        )}
        <button
          className="btn-primary"
          style={{ width: "100%", fontSize: "1.11rem", marginTop: "1rem" }}
          onClick={generate}
          disabled={!captured || isGenerating}>
          {isGenerating ? "Generating..." : "Generate Illustration"}
        </button>
      </div>
    </div>
  );

  const GeneratingScreen = () => (
    <div className="generating-container">
      <Header />
      <div className="spinner"></div>
      <h2>Generating your illustration…</h2>
      <p>We’re analyzing and applying ING’s style.</p>
    </div>
  );

  const ResultScreen = () => (
    <div style={{ display: "flex", minHeight: "100vh", backgroundColor: "#F7F7F7", padding: "2rem", gap: "2rem" }}>
      <Header />
      <div style={{ flex: 2, display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{ background: "#ffffff", borderRadius: "1rem", boxShadow: "0 2px 6px rgba(0,0,0,0.1)", overflow: "hidden", position: "relative" }}>
          <div style={{ borderBottom: "1px solid #ECECEC", padding: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#333333" }}>Your ING Illustration</h2>
            <a href={resultUrl} download="ilustracion_ing.png" style={{ backgroundColor: "#FF6200", color: "#ffffff", padding: "0.75rem 1.25rem", borderRadius: "0.75rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem", textDecoration: "none" }}>
              Download
            </a>
          </div>
          <div style={{ background: "#F7F7F7", padding: "1rem", display: "flex", justifyContent: "center" }}>
            <img src={resultUrl} alt="Ilustración generada" style={{ width: "100%", borderRadius: "0.75rem", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }} />
          </div>
        </div>
        {brandRefs.length > 0 && (
          <div style={{ background: "#ffffff", borderRadius: "1rem", boxShadow: "0 2px 6px rgba(0,0,0,0.1)", padding: "1rem" }}>
            <h3 style={{ fontSize: "1.125rem", fontWeight: 600, color: "#333333", marginBottom: "0.75rem" }}>References</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(4rem,1fr))", gap: "0.75rem" }}>
              {brandRefs.map((ref, idx) => (
                <div key={idx} style={{ textAlign: "center" }}>
                  <img src={ref.url} alt={ref.title} style={{ width: "100%", height: "4rem", objectFit: "cover", borderRadius: "0.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }} />
                  <p style={{ fontSize: "0.75rem", color: "#666666", marginTop: "0.5rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ref.title}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{ background: "#ffffff", borderRadius: "1rem", boxShadow: "0 2px 6px rgba(0,0,0,0.1)", padding: "1rem" }}>
          <h3 style={{ fontSize: "1.125rem", fontWeight: 600, color: "#333333", marginBottom: "0.75rem" }}>Personalization</h3>
          {/* aquí van los botones y sub-menús igual que antes */}
        </div>
        <div style={{ background: "#ffffff", borderRadius: "1rem", boxShadow: "0 2px 6px rgba(0,0,0,0.1)", padding: "1rem" }}>
          <h3 style={{ fontSize: "1.125rem", fontWeight: 600, color: "#333333", marginBottom: "0.75rem" }}>Actions</h3>
          <button onClick={generate} disabled={isGenerating} className="regenerate-btn">
            Regenerate Image
          </button>
        </div>
        {isGenerating && (
          <div style={{ background: "#FFF8E1", borderRadius: "1rem", boxShadow: "0 2px 6px rgba(0,0,0,0.1)", padding: "1rem", display: "flex", alignItems: "center", gap: "1rem" }}>
            <div style={{ width: "1.5rem", height: "1.5rem", border: "0.25rem solid #FF6200", borderTopColor: "transparent", borderRadius: "9999px", animation: "spin 1s infinite linear" }} />
            <div>
              <span style={{ fontWeight: 600, color: "#FF8A00" }}>Processing…</span>
              <p style={{ fontSize: "0.875rem", color: "#FF8A00", marginTop: "0.25rem" }}>Applying changes, please wait.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (currentScreen === "welcome")    return <WelcomeScreen />;
  if (currentScreen === "capture")    return <CaptureScreen />;
  if (currentScreen === "generating") return <GeneratingScreen />;
  if (currentScreen === "result")     return <ResultScreen />;
  return <WelcomeScreen />;
}
