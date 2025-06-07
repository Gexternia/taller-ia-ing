import { useRef, useState, useEffect } from "react";
import "./styles.css";

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [captured, setCaptured] = useState(null);
  const [resultUrl, setResultUrl] = useState(null);
  const [responseId, setResponseId] = useState(null);
  const [imageCallId, setImageCallId] = useState(null);
  const [brandRefs, setBrandRefs] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [originalDescription, setOriginalDescription] = useState("");
  const [prevImageUrl, setPrevImageUrl] = useState("");
  const [showColorOptions, setShowColorOptions] = useState(false);
  const [showChatBox, setShowChatBox] = useState(false);
  const [showTitleOptions, setShowTitleOptions] = useState(false);
  const [chatText, setChatText] = useState("");
  const [currentScreen, setCurrentScreen] = useState("welcome");
  const [cameraMode, setCameraMode] = useState("idle"); // "idle" | "active"

  /* — Cámara / Upload — */
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      videoRef.current.srcObject = stream;
      setCameraMode("active");
    } catch (e) {
      alert("Could not activate the camera.");
    }
  }

  function takeShot() {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      setCaptured(blob);
      stopCamera();
    }, "image/png");
  }

  function stopCamera() {
    const stream = videoRef.current?.srcObject;
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraMode("idle");
  }

  function onFile(e) {
    stopCamera();
    setCaptured(e.target.files[0]);
  }

  /* — Generación inicial — */
  async function generate() {
    if (!captured) { alert("Upload or capture an image first"); return; }
    setIsGenerating(true);
    setCurrentScreen("generating");
    // reset estados
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
    const res = await fetch("/api/generate", { method: "POST", body: form });
    const data = await res.json();
    if (data.error) {
      alert("Error: " + data.error);
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

  /* — Iteraciones — */
  async function iterate(action, param) {
    if (!responseId || !imageCallId) {
      alert("First generate the initial image");
      return;
    }
    setIsGenerating(true);

    // Título IA
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
      if (error) { alert("Error: " + error); setIsGenerating(false); return; }
      const userTitle = window.prompt("Edit title:", suggestedTitle);
      if (userTitle) await iterate("add_title", userTitle);
      else setIsGenerating(false);
      return;
    }

    // Payload normal
    const payload = {
      previousResponseId: responseId,
      imageCallId,
      action,
      originalDescription: { text: originalDescription, prevImageUrl }
    };
    if (param) payload.actionParam = param;

    const res2 = await fetch("/api/iterate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data2 = await res2.json();
    if (data2.error) {
      alert("Error: " + data2.error);
      setIsGenerating(false);
      return;
    }
    setResultUrl(data2.resultUrl);
    setResponseId(data2.responseId);
    setImageCallId(data2.imageCallId);
    setPrevImageUrl(data2.resultUrl);
    setIsGenerating(false);
    setShowColorOptions(false);
    setShowChatBox(false);
    setShowTitleOptions(false);
    setChatText("");
  }

  function resetApp() {
    stopCamera();
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
    setIsGenerating(false);
  }

  const Spinner = () => <div className="spinner" />;

  /* — HEADER — */
  const Header = () => (
    <div className="header">
      <div className="logo-container">
        <img src="/images/logo.png" alt="ING Logo" />
      </div>
      <nav>
        <button onClick={() => setCurrentScreen("welcome")} className={currentScreen === "welcome" ? "active" : ""}>Home</button>
        <button onClick={() => setCurrentScreen("capture")} className={currentScreen === "capture" ? "active" : ""}>Capture</button>
        <button onClick={() => {
            resultUrl ? setCurrentScreen("result") : alert("First generate an image");
          }} className={currentScreen === "result" ? "active" : ""}>Iteration</button>
        <button className="nav-link" onClick={() => window.open("https://form.typeform.com/to/Al1mzBDY", "_blank")}>Voting</button>
      </nav>
      <button className="reiniciar-btn" onClick={resetApp}>Reset</button>
    </div>
  );

  /* — PANTALLAS — */
  const WelcomeScreen = () => (
    <div className="welcome-container">
      <Header/>
      <div className="welcome-left">
        <h1>Your strategy.<br/>Your style.<br/>Your illustration.</h1>
        <p>Transform your ideas into professional illustrations with AI & ING style.</p>
        <button className="btn-primary" onClick={() => setCurrentScreen("capture")}>Get Started →</button>
      </div>
      <div className="welcome-right">
        <img src="/images/nueva-portada.jpg" alt="Team working" />
        <div className="overlay-gradient"></div>
      </div>
    </div>
  );

  const CaptureScreen = () => (
    <div className="capture-container">
      <Header/>
      <div className="capture-left">
        <h1 className="cap-title">Capture Your<br/>Strategy</h1>
        <p className="cap-sub">Take a photo or upload your sketch.</p>
      </div>
      <div className="capture-right">
        <div className="camera-controls">
          <button className="btn-primary" onClick={() => cameraMode === "idle" ? startCamera() : takeShot()} disabled={isGenerating}>
            {cameraMode === "idle" ? "Activate Camera" : "Capture"}
          </button>
        </div>
        {cameraMode === "active" && (
          <div className="video-preview">
            <video ref={videoRef} autoPlay className="camera-preview" />
            <canvas ref={canvasRef} className="hidden" />
          </div>
        )}
        <div className="upload-section">
          <label className="upload-btn" htmlFor="file-upload">Upload Image
            <input id="file-upload" type="file" accept="image/*" onChange={onFile} hidden disabled={isGenerating}/>
          </label>
        </div>
        <div className="preview-box">
          {captured && <img src={URL.createObjectURL(captured)} alt="Preview" />}
        </div>
        <button className="btn-primary generate-btn" onClick={generate} disabled={!captured || isGenerating}>
          {isGenerating ? "Generating…" : "Generate Illustration"}
        </button>
      </div>
    </div>
  );

  const GeneratingScreen = () => (
    <div className="generating-container">
      <Header/>
      <Spinner/>
      <h2>Generating your illustration…</h2>
      <p>We’re analyzing and applying ING’s style.</p>
    </div>
  );

  const ResultScreen = () => (
    <div className="result-container">
      <Header/>
      <div className="result-box">
        <a href={resultUrl} download="illustration_ing.png"><button className="btn-primary download-btn">Download</button></a>
        <img src={resultUrl} alt="Result" />
      </div>
      {isGenerating && (
        <div className="iter-loader">
          <Spinner/>
          <div>
            <strong>Processing…</strong>
            <p>Applying changes, please wait.</p>
          </div>
        </div>
      )}
      {/* Iteration panel */}
      <div className="iteration-panel">
        <div className="panel-section">
          <h3>Personalization</h3>
          <button onClick={() => { setShowColorOptions(!showColorOptions); setShowChatBox(false); setShowTitleOptions(false); }}>Change Colors</button>
          <button onClick={() => { setShowTitleOptions(!showTitleOptions); setShowColorOptions(false); setShowChatBox(false); }}>Add Title</button>
          <button onClick={() => { setShowChatBox(!showChatBox); setShowColorOptions(false); setShowTitleOptions(false); }}>Modify with AI</button>
        </div>
        {showColorOptions && (
          <div className="panel-submenu">
            {[["#FF6200","#89D6FD","#4D0020","#F689FD"],["#FF6200","#4D0020","#D40199","#F689FD"]].map((palette,i)=>(
              <button key={i} onClick={()=>iterate("change_palette", palette.join(","))}>Palette {i+1}</button>
            ))}
          </div>
        )}
        {showTitleOptions && (
          <div className="panel-submenu">
            <button onClick={()=>iterate("add_title")}>Custom Title</button>
            <button onClick={()=>iterate("suggest_title")}>AI Suggest Title</button>
          </div>
        )}
        {showChatBox && (
          <div className="panel-submenu">
            <textarea maxLength={250} rows={3} value={chatText} onChange={e=>setChatText(e.target.value)} placeholder="Describe your changes…"/>
            <button onClick={()=>iterate("chat", chatText)} disabled={!chatText.trim()}>Apply</button>
          </div>
        )}
        <div className="panel-section">
          <h3>Actions</h3>
          <button className="regenerate-btn" onClick={generate}>Regenerate Image</button>
        </div>
      </div>
    </div>
  );

  switch(currentScreen) {
    case "welcome": return <WelcomeScreen/>;
    case "capture": return <CaptureScreen/>;
    case "generating": return <GeneratingScreen/>;
    case "result": return <ResultScreen/>;
    default: return <WelcomeScreen/>;
  }
}
