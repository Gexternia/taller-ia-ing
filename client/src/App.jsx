import { useRef, useState } from "react";
import "./styles.css";

export default function App() {
  // Refs cámara
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);

  // Estados principales
  const [captured, setCaptured]         = useState(null);
  const [resultUrl, setResultUrl]       = useState(null);
  const [responseId, setResponseId]     = useState(null);
  const [imageCallId, setImageCallId]   = useState(null);
  const [brandRefs, setBrandRefs]       = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // Estados de iteración
  const [originalDescription, setOriginalDescription] = useState("");
  const [prevImageUrl, setPrevImageUrl]               = useState("");
  const [showColorOptions, setShowColorOptions]       = useState(false);
  const [showChatBox, setShowChatBox]                 = useState(false);
  const [showTitleOptions, setShowTitleOptions]       = useState(false);
  const [chatText, setChatText]                       = useState("");

  // Estado de navegación interna
  const [currentScreen, setCurrentScreen] = useState("welcome");
  // Modo cámara
  const [cameraMode, setCameraMode] = useState("idle"); // "idle" | "active"
  const [isCameraOn, setIsCameraOn] = useState(false);

  // ==== Cámara ====

  async function startCamera() {
    // Si había un stream activo, detenerlo primero
    if (videoRef.current?.srcObject) stopCamera();

    try {
      const constraints = {
        video: { facingMode: { ideal: "environment" } },
        audio: false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      const video = videoRef.current;
      video.srcObject   = stream;
      video.muted       = true;  // evita pedir permiso de audio
      video.playsInline = true;  // necesario en iOS
      await video.play();        // arranca el vídeo

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

  // ==== Generación ====

  async function generate() {
    if (!captured) {
      alert("Sube o captura una imagen primero");
      return;
    }
    setIsGenerating(true);
    setCurrentScreen("generating");

    // Resetear estados de iteración
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

    // Caso suggest_title (prompt + ventana de edición)
    if (action === "suggest_title") {
      const res = await fetch("/api/iterate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
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

    // add_title sin parámetro -> pedirlo
    if (action === "add_title" && !param) {
      const userTitle = window.prompt("Escribe el título que quieras añadir:");
      if (!userTitle) {
        setIsGenerating(false);
        return;
      }
      param = userTitle;
    }

    // chat sin texto
    if (action === "chat" && !param) {
      alert("Escribe algo en el cuadro de chat antes de enviar");
      setIsGenerating(false);
      return;
    }

    // Llamada genérica a /api/iterate
    const payload = {
      previousResponseId: responseId,
      imageCallId,
      action,
      originalDescription: { text: originalDescription, prevImageUrl }
    };
    if (param) payload.actionParam = param;

    const res  = await fetch("/api/iterate", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload)
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

  // =========================== RENDER ===========================

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
          className={
            currentScreen === "result"
              ? "active"
              : resultUrl
              ? ""
              : "disabled"
          }
        >
          Iteration
        </button>
        <button
          className="nav-link"
          onClick={() => window.open("https://form.typeform.com/to/Al1mzBDY", "_blank")}
        >
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
      <div className="capture-left">
        {/* ... tu contenido izquierdo ... */}
      </div>
      <div className="capture-right">
        <div className="camera-controls">
          <button
            className="btn-primary"
            onClick={() => cameraMode === "idle" ? startCamera() : takeShot()}
            disabled={isGenerating}
          >
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
            />
            <canvas ref={canvasRef} className="hidden" />
          </div>
        )}
        <div className="upload-section">
          <label className="upload-btn" htmlFor="file-upload">
            Upload Image
            <input
              id="file-upload"
              type="file"
              accept="image/*"
              onChange={onFile}
              hidden
              disabled={isGenerating}
            />
          </label>
        </div>
        {captured && (
          <div className="preview-box">
            <img src={URL.createObjectURL(captured)} alt="Preview" />
          </div>
        )}
        <button
          className="btn-primary"
          onClick={generate}
          disabled={!captured || isGenerating}
        >
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
    <div className="result-container">
      <Header />
      {/* ... tu layout de resultados + iteración ... */}
    </div>
  );

  // Switch de pantallas
  if (currentScreen === "welcome")    return <WelcomeScreen />;
  if (currentScreen === "capture")    return <CaptureScreen />;
  if (currentScreen === "generating") return <GeneratingScreen />;
  if (currentScreen === "result")     return <ResultScreen />;
  return <WelcomeScreen />;
}
