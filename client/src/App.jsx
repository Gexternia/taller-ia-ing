import { useRef, useState } from "react";
import "./styles.css";

export default function App() {
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);

  const [isCameraOn, setIsCameraOn]       = useState(false);
  const [captured, setCaptured]           = useState(null);
  const [resultUrl, setResultUrl]         = useState(null);
  const [responseId, setResponseId]       = useState(null);
  const [imageCallId, setImageCallId]     = useState(null);
  const [brandRefs, setBrandRefs]         = useState([]);
  const [isGenerating, setIsGenerating]   = useState(false);
  const [originalDescription, setOriginalDescription] = useState("");
  const [prevImageUrl, setPrevImageUrl]               = useState("");
  const [showColorOptions, setShowColorOptions]   = useState(false);
  const [showChatBox, setShowChatBox]             = useState(false);
  const [showTitleOptions, setShowTitleOptions]   = useState(false);
  const [chatText, setChatText]                   = useState("");
  const [currentScreen, setCurrentScreen]         = useState("welcome");

  /* Cámara */
  async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    videoRef.current.srcObject = stream;
    setIsCameraOn(true);
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

  /* Generación */
  async function generate() {
    if (!captured) { alert("Upload or capture an image first"); return; }
    setIsGenerating(true);
    setCurrentScreen("generating");
    setResultUrl(null);
    /* limpia estados de iteración */
    setResponseId(null); setImageCallId(null);
    setBrandRefs([]); setShowColorOptions(false);
    setShowChatBox(false); setShowTitleOptions(false);
    setOriginalDescription(""); setPrevImageUrl("");

    const form = new FormData();
    form.append("image", captured, "input.png");
    const res  = await fetch("/api/generate", { method: "POST", body: form });
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

  /* Iteraciones (incluye titulo, chat, paleta, etc.) */
  async function iterate(action, param) {
    if (!responseId || !imageCallId) {
      alert("First generate the initial image"); return;
    }
    setIsGenerating(true);

    /* caso suggest_title */
    if (action === "suggest_title") {
      const res = await fetch("/api/iterate", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({
          previousResponseId: responseId,
          imageCallId, action,
          originalDescription: { text: originalDescription, prevImageUrl }
        })
      });
      const { suggestedTitle, error } = await res.json();
      if (error) { alert("Error: "+error); setIsGenerating(false); return; }
      const userTitle = window.prompt("Edit title:", suggestedTitle);
      if (userTitle) await iterate("add_title", userTitle);
      else setIsGenerating(false);
      return;
    }

    /* payload normal */
    const payload = {
      previousResponseId: responseId,
      imageCallId, action,
      originalDescription: { text: originalDescription, prevImageUrl }
    };
    if (param) payload.actionParam = param;

    const res2 = await fetch("/api/iterate", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });
    const data2 = await res2.json();
    if (data2.error) {
      alert("Error: "+data2.error);
      setIsGenerating(false);
      return;
    }

    setResultUrl(data2.resultUrl);
    setResponseId(data2.responseId);
    setPrevImageUrl(data2.resultUrl);
    setImageCallId(data2.imageCallId);
    setIsGenerating(false);
    setShowColorOptions(false);
    setShowChatBox(false);
    setShowTitleOptions(false);
    setChatText("");
  }

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
    setIsCameraOn(false);
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(t=>t.stop());
    }
  }

  /* Spinner component */
  const Spinner = () => <div className="spinner" />;

  /* HEADER común */
  const Header = () => (
    <div className="header">
      <div className="logo-container">
        <img src="/images/logo.png" alt="ING Logo" />
      </div>
      <nav>
        <button onClick={()=>setCurrentScreen("welcome")}
                className={currentScreen==="welcome"?"active":""}>
          Home
        </button>
        <button onClick={()=>setCurrentScreen("capture")}
                className={currentScreen==="capture"?"active":""}>
          Capture
        </button>
        <button onClick={()=>{
            resultUrl?setCurrentScreen("result"):alert("First generate an image");
          }}
          className={currentScreen==="result"?"active":""}>
          Iteration
        </button>
        <a href="https://form.typeform.com/to/Al1mzBDY" target="_blank" rel="noreferrer">
          Voting
        </a>
      </nav>
      <button className="reiniciar-btn" onClick={resetApp}>Reset</button>
    </div>
  );

  /* PANTALLAS */
  const WelcomeScreen = () => (
    <div className="welcome-container">
      <Header/>
      <div className="welcome-left">
        <h1>Your strategy.<br/>Your style.<br/>Your illustration.</h1>
        <p>Transform your ideas into professional illustrations with AI & ING style.</p>
        <button className="btn-primary" onClick={()=>setCurrentScreen("capture")}>
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
      <Header/>
      <div className="capture-left">
        <h1>Capture Your<br/>Strategy</h1>
        <p>Take a photo or upload your sketch.</p>
      </div>
      <div className="capture-right">
        <div className="camera-controls">
          <button className="btn-primary" onClick={startCamera} disabled={isGenerating}>
            Activate Camera
          </button>
          <button className="btn-primary" onClick={takeShot}
                  disabled={!isCameraOn || isGenerating}>
            Capture
          </button>
        </div>
        <div className="preview-box">
          {captured && <img src={URL.createObjectURL(captured)} alt="Preview" />}
        </div>
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
        <a href={resultUrl} download="illustration_ing.png" style={{
          position: 'absolute', top: '1rem', right: '1rem', zIndex: 10
        }}>
          <button className="btn-primary">Download</button>
        </a>
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
    </div>
  );

  /* SWITCH */
  if (currentScreen === "welcome")   return <WelcomeScreen/>;
  if (currentScreen === "capture")   return <CaptureScreen/>;
  if (currentScreen === "generating")return <GeneratingScreen/>;
  if (currentScreen === "result")    return <ResultScreen/>;
  return <WelcomeScreen/>;
}
