import { useState, useCallback, useMemo } from "react";
import "./styles.css";

export default function App() {
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

  const resetApp = useCallback(() => {
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
  }, []);

  const generate = useCallback(async () => {
    if (!captured) return;
    setIsGenerating(true);
    setCurrentScreen("generating");
    const form = new FormData();
    form.append("image", captured);

    try {
      const res = await fetch("/api/generate", { method: "POST", body: form });
      const data = await res.json();
      if (data.error) {
        alert("Error generando ilustración: " + data.error);
        setCurrentScreen("capture");
        return;
      }
      setResultUrl(data.resultUrl);
      setBrandRefs(data.brandRefs || []);
      setResponseId(data.responseId);
      setImageCallId(data.imageCallId);
      setOriginalDescription(data.description || "");
      setPrevImageUrl(data.resultUrl);
      setCurrentScreen("result");
    } catch (err) {
      console.error("generate error:", err);
      alert("Error de red al generar la imagen.");
      setCurrentScreen("capture");
    } finally {
      setIsGenerating(false);
    }
  }, [captured]);

  const iterate = useCallback(async (action, param) => {
    if (!responseId || !imageCallId) {
      alert("Primero genera la imagen inicial");
      return;
    }
    setIsGenerating(true);

    const payload = {
      previousResponseId: responseId,
      imageCallId,
      action,
      originalDescription: { text: originalDescription, prevImageUrl }
    };
    if (param) payload.actionParam = param;

    try {
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

      if (action === "add_title" && !param) {
        const userTitle = window.prompt("Escribe el título que quieres añadir:");
        if (!userTitle) return;
        param = userTitle;
        payload.actionParam = param;
      }

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
  }, [responseId, imageCallId, originalDescription, prevImageUrl]);

  const handleNavigation = useCallback((screen) => {
    if (screen === "result" && !resultUrl) {
      alert("Primero genera una imagen");
      return;
    }
    setCurrentScreen(screen);
  }, [resultUrl]);

  const handleChatTextChange = useCallback((e) => {
    setChatText(e.target.value);
  }, []);

  const handleChatSubmit = useCallback(() => {
    iterate("chat", chatText);
    setShowChatBox(false);
    setChatText("");
  }, [iterate, chatText]);

  const Header = useMemo(() => () => (
    <div className="header">
      <div className="logo-container" onClick={resetApp}>
        <img src="/images/logo.png" alt="ING Logo" />
      </div>
      <nav>
        <button
          onClick={() => handleNavigation("welcome")}
          className={currentScreen === "welcome" ? "active" : ""}
        >
          Home
        </button>
        <button
          onClick={() => handleNavigation("capture")}
          className={currentScreen === "capture" ? "active" : ""}
        >
          Capture
        </button>
        <button
          onClick={() => handleNavigation("result")}
          className={`${currentScreen === "result" ? "active" : ""} ${!resultUrl ? "nav-disabled" : ""}`}
          disabled={!resultUrl}
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
    </div>
  ), [currentScreen, resultUrl, handleNavigation, resetApp]);

  const WelcomeScreen = useCallback(() => (
    <div className="welcome-container">
      <Header />
      <div className="welcome-content">
        <div className="welcome-left">
          <h1>
            Your strategy.<br />
            Your style.<br />
            Your illustration.
          </h1>
          <p>
            Transform your ideas into professional illustrations with AI & ING style.
          </p>
          <button
            className="btn-primary"
            onClick={() => setCurrentScreen("capture")}
          >
            Get Started →
          </button>
        </div>
        <div className="welcome-right">
          <img src="/images/nueva-portada.jpg" alt="Team working" />
          <div className="overlay-gradient"></div>
        </div>
      </div>
    </div>
  ), []);

  const CaptureScreen = useCallback(() => (
    <div className="capture-container">
      <Header />
      <div className="capture-content">
        <div className="capture-left">
          <div className="capture-info">
            <h2>
              Take a photo.<br />
              Transform your strategy.
            </h2>
            <p>
              Take a photo or upload your sketch to generate an ING-style illustration.
            </p>
          </div>
          <div className="capture-bg" />
        </div>

        <div className="capture-right">
          <div className="upload-section">
            <label className="upload-btn btn-secondary" htmlFor="file-upload">
              {captured ? "Change Image" : "Take Photo / Upload"}
              <input
                id="file-upload"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={e => setCaptured(e.target.files[0])}
                hidden
                disabled={isGenerating}
              />
            </label>
          </div>
          
          {captured && (
            <div className="preview-box">
              <img
                src={URL.createObjectURL(captured)}
                alt="Preview"
              />
            </div>
          )}

          <button
            className="btn-primary generate-btn"
            onClick={generate}
            disabled={!captured || isGenerating}
          >
            {isGenerating ? "Generating…" : "Generate Illustration →"}
          </button>
        </div>
      </div>
    </div>
  ), [captured, isGenerating, generate]);

  const GeneratingScreen = useCallback(() => (
    <div className="generating-container">
      <Header />
      <div className="generating-content">
        <div className="spinner"></div>
        <h2>Generating your illustration…</h2>
        <p>We're analyzing and applying ING's style.</p>
      </div>
    </div>
  ), []);

  const ColorPalettesMenu = useCallback(() => {
    const palettes = [
      { name: "Orange + Sky + Maroon + Blush", colors: ["#FF6200", "#89D6FD", "#4D0020", "#F689FD"] },
      { name: "Orange + Maroon + Raspberry + Blush", colors: ["#FF6200", "#4D0020", "#D40199", "#F689FD"] },
      { name: "Orange + Raspberry + Blush + Sun", colors: ["#FF6200", "#D40199", "#F689FD", "#FFE100"] },
      { name: "Orange + Violet + Sky + Maroon", colors: ["#FF6200", "#7724FF", "#89D6FD", "#4D0020"] }
    ];

    return (
      <div className="submenu">
        <p className="submenu-title">Palettes</p>
        {palettes.map((palette, idx) => (
          <button
            key={idx}
            onClick={() => iterate("change_palette", palette.colors.join(", "))}
            disabled={isGenerating}
            className="palette-btn"
          >
            <div className="palette-colors">
              {palette.colors.map((color, i) => (
                <span key={i} className="color-dot" style={{ backgroundColor: color }}></span>
              ))}
            </div>
            <span className="palette-name">{palette.name}</span>
          </button>
        ))}
      </div>
    );
  }, [iterate, isGenerating]);

  const TitleOptionsMenu = useCallback(() => (
    <div className="submenu">
      <p className="submenu-title">Title options</p>
      <button
        onClick={() => iterate("add_title")}
        disabled={isGenerating}
        className="submenu-btn"
      >
        Custom Title
      </button>
      <button
        onClick={() => iterate("suggest_title")}
        disabled={isGenerating}
        className="submenu-btn"
      >
        AI-generated Title
      </button>
    </div>
  ), [iterate, isGenerating]);

  const ResultScreen = () => (
    <div className="result-container">
      <Header />
      <div className="result-content">
        <div className="result-left">
          <div className="result-image-card">
            <div className="card-header">
              <h2>Your ING Illustration</h2>
              <a
                href={resultUrl}
                download="ilustracion_ing.png"
                className="download-btn"
              >
                Download
              </a>
            </div>
            <div className="image-container">
              <img src={resultUrl} alt="Ilustración generada" />
            </div>
          </div>

          {brandRefs.length > 0 && (
            <div className="references-card">
              <h3>References</h3>
              <div className="ref-grid">
                {brandRefs.map((ref, index) => (
                  <div key={index} className="ref-item">
                    <img src={ref.url} alt={ref.title} />
                    <p className="ref-title">{ref.title}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="result-right">
          <div className="personalization-card">
            <h3>Personalization</h3>
            <div className="option-buttons">
              <button
                onClick={() => {
                  setShowColorOptions(!showColorOptions);
                  setShowChatBox(false);
                  setShowTitleOptions(false);
                }}
                disabled={isGenerating}
                className="option-btn"
              >
                <div className="option-icon color-icon"></div>
                <div className="option-text">
                  <p className="option-title">Change Colors</p>
                  <p className="option-subtitle">ING palettes</p>
                </div>
              </button>

              <button
                onClick={() => {
                  setShowTitleOptions(!showTitleOptions);
                  setShowColorOptions(false);
                  setShowChatBox(false);
                }}
                disabled={isGenerating}
                className="option-btn"
              >
                <div className="option-icon title-icon">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2m-9 0h10a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2z" />
                  </svg>
                </div>
                <div className="option-text">
                  <p className="option-title">Add Title</p>
                  <p className="option-subtitle">Custom text</p>
                </div>
              </button>

              <button
                onClick={() => {
                  setShowChatBox(!showChatBox);
                  setShowColorOptions(false);
                  setShowTitleOptions(false);
                }}
                disabled={isGenerating}
                className="option-btn"
              >
                <div className="option-icon chat-icon">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <div className="option-text">
                  <p className="option-title">Modify with AI</p>
                  <p className="option-subtitle">Custom instructions</p>
                </div>
              </button>
            </div>

            {showColorOptions && <ColorPalettesMenu />}
            {showTitleOptions && <TitleOptionsMenu />}
            {showChatBox && (
              <div className="submenu">
                <p className="submenu-title">Modify with AI</p>
                <textarea
                  key="ai-textarea"
                  rows={3}
                  maxLength={250}
                  placeholder="Describe the changes you want to apply…"
                  value={chatText}
                  onChange={handleChatTextChange}
                  disabled={isGenerating}
                  className="ai-textarea"
                  autoFocus
                />
                <div className="textarea-footer">
                  <span className="char-count">{chatText.length}/250 chars</span>
                  <button
                    onClick={handleChatSubmit}
                    disabled={isGenerating || !chatText.trim()}
                    className="apply-btn"
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="actions-card">
            <h3>Actions</h3>
            <button
              onClick={generate}
              disabled={isGenerating}
              className="regenerate-btn"
            >
              Regenerate Image
            </button>
          </div>

          {isGenerating && (
            <div className="loading-card">
              <div className="loading-spinner"></div>
              <div className="loading-text">
                <span className="loading-title">Processing…</span>
                <p className="loading-subtitle">Applying changes, please wait.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (currentScreen === "welcome") return <WelcomeScreen />;
  if (currentScreen === "capture") return <CaptureScreen />;
  if (currentScreen === "generating") return <GeneratingScreen />;
  if (currentScreen === "result") return <ResultScreen />;

  return <WelcomeScreen />;
}