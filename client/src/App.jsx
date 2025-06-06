// client/src/App.jsx
import { useRef, useState } from "react";
import "./styles.css"; // Carga tu CSS “puro” con @font-face y clases ING

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

  const [showColorOptions, setShowColorOptions]   = useState(false);
  const [showChatBox, setShowChatBox]             = useState(false);
  const [showTitleOptions, setShowTitleOptions]   = useState(false);
  const [chatText, setChatText]                   = useState("");

  const [currentScreen, setCurrentScreen] = useState("welcome");

  /* ---------- Cámara / archivo ---------- */
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

  /* ---------- Generación inicial ---------- */
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

  /* ---------- Iteraciones ---------- */
  async function iterate(action, param) {
    if (!responseId || !imageCallId) {
      alert("Primero genera la imagen inicial");
      return;
    }
    setIsGenerating(true);

    /* 1) Sugerir título con IA */
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

    /* 2) Añadir título libre */
    if (action === "add_title" && !param) {
      const userTitle = window.prompt("Escribe el título que quieras añadir:");
      if (!userTitle) {
        setIsGenerating(false);
        return;
      }
      param = userTitle;
    }

    /* 3) Modificación vía chat */
    if (action === "chat" && !param) {
      alert("Escribe algo en el cuadro de chat antes de enviar");
      setIsGenerating(false);
      return;
    }

    /* 4) Llamada normal de iteración */
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

  /* ---------- Reiniciar toda la app ---------- */
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

    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
  }

  // ===========================
  //   RENDER DE CADA PANTALLA
  // ===========================

  /* ----- A) HEADER FIJO ----- */
  const Header = () => (
    <div className="header">
      {/* Logo ING + Leó n */}
      <div className="logo-container">
        <div className="logo-box">
          <span>ING</span>
        </div>
        <span>🦁</span>
      </div>

      {/* Menú de navegación */}
      <nav>
        <button
          onClick={() => setCurrentScreen("welcome")}
          className={currentScreen === "welcome" ? "active" : ""}
        >
          ING
        </button>
        <button
          onClick={() => setCurrentScreen("capture")}
          className={currentScreen === "capture" ? "active" : ""}
        >
          Captura
        </button>
        <button
          onClick={() => {
            if (resultUrl) setCurrentScreen("result");
            else alert("Primero genera una imagen");
          }}
          className={currentScreen === "result" ? "active" : resultUrl ? "" : "disabled"}
        >
          Iteración
        </button>
        <button className="disabled" title="Próximamente disponible">
          Votación
        </button>
      </nav>

      <button onClick={resetApp} className="reiniciar-btn">
        Reiniciar
      </button>
    </div>
  );

  /* ----- B) PANTALLA DE BIENVENIDA ----- */
  const WelcomeScreen = () => (
    <div className="welcome-container">
      <Header />

      {/* IZQUIERDA (naranja) */}
      <div className="welcome-left">
        <h1>
          Tu estrategia.<br />
          Tu estilo.<br />
          Tu ilustración.
        </h1>
        <p>
          Transforma tus ideas estratégicas en ilustraciones profesionales con el poder de la IA y el estilo visual de ING.
        </p>
        <button
          className="btn-primary"
          onClick={() => setCurrentScreen("capture")}
        >
          Comenzar ahora →
        </button>
      </div>

      {/* DERECHA (imagen) */}
      <div className="welcome-right">
        <img
          src="https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=800&h=1000&fit=crop&crop=faces"
          alt="Personas trabajando en estrategia"
        />
        <div className="overlay-gradient"></div>
      </div>
    </div>
  );

  /* ----- C) PANTALLA DE CAPTURA ----- */
  const CaptureScreen = () => (
    <div className="welcome-container">
      <Header />

      {/* IZQUIERDA (naranja) */}
      <div className="welcome-left">
        <h1>
          Captura tu<br />
          estrategia
        </h1>
        <p>
          Haz una foto de tu esquema o sube una imagen. Nuestra IA analizará el contenido y creará una ilustración profesional.
        </p>

        {captured && (
          <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: '1rem', padding: '1rem', marginTop: '1rem' }}>
            <p style={{ color: '#FFD1C1', marginBottom: '0.5rem' }}>Vista previa:</p>
            <div style={{ background: '#ffffff', borderRadius: '0.5rem', padding: '0.5rem', marginBottom: '0.5rem' }}>
              <img
                src={URL.createObjectURL(captured)}
                alt="Vista previa"
                style={{ width: '100%', borderRadius: '0.5rem' }}
              />
            </div>
            <button
              onClick={generate}
              disabled={isGenerating}
              style={{
                width: '100%',
                background: '#ffffff',
                color: '#FF6200',
                padding: '0.75rem',
                borderRadius: '0.75rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                cursor: isGenerating ? 'not-allowed' : 'pointer',
                opacity: isGenerating ? 0.5 : 1
              }}
            >
              <span>{isGenerating ? "Generando..." : "Generar ilustración"}</span>
              {!isGenerating && (
                <svg style={{ width: '1rem', height: '1rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </button>
          </div>
        )}
      </div>

      {/* DERECHA (opciones) */}
      <div style={{ flex: 1, backgroundColor: '#FFF0EB', padding: '2.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Opciones de captura</h2>

        {/* Caja “Usar cámara” */}
        <div style={{
          background: '#ffffff',
          borderRadius: '1rem',
          padding: '1.5rem',
          boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
          marginBottom: '1.5rem'
        }}>
          <h3 style={{ fontWeight: 600, color: '#333333', marginBottom: '1rem', textAlign: 'center' }}>Usar cámara</h3>
          <video
            ref={videoRef}
            autoPlay
            className={videoRef.current?.srcObject ? '' : 'hidden'}
            style={{ width: '100%', borderRadius: '0.75rem', marginBottom: '1rem' }}
          />
          <canvas ref={canvasRef} className="hidden" />
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              onClick={startCamera}
              disabled={isGenerating}
              style={{
                flex: 1,
                background: '#333333',
                color: '#ffffff',
                padding: '0.75rem',
                borderRadius: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                cursor: isGenerating ? 'not-allowed' : 'pointer',
                opacity: isGenerating ? 0.5 : 1
              }}
            >
              <span>Activar cámara</span>
              <svg style={{ width: '1rem', height: '1rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <button
              onClick={takeShot}
              disabled={isGenerating || !videoRef.current?.srcObject}
              style={{
                flex: 1,
                background: '#FF6200',
                color: '#ffffff',
                padding: '0.75rem',
                borderRadius: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                cursor: (isGenerating || !videoRef.current?.srcObject) ? 'not-allowed' : 'pointer',
                opacity: (isGenerating || !videoRef.current?.srcObject) ? 0.5 : 1
              }}
            >
              <span>Capturar</span>
              <svg style={{ width: '1rem', height: '1rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Caja “Subir archivo” */}
        <div style={{
          background: '#ffffff',
          borderRadius: '1rem',
          padding: '1.5rem',
          boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
        }}>
          <h3 style={{ fontWeight: 600, color: '#333333', marginBottom: '1rem', textAlign: 'center' }}>Subir archivo</h3>
          <div
            onClick={() => document.getElementById("file-upload").click()}
            style={{
              border: '2px dashed #CCCCCC',
              borderRadius: '1rem',
              padding: '2rem',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'border-color 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = '#FF6200'}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#CCCCCC'}
          >
            <input
              id="file-upload"
              type="file"
              accept="image/*"
              onChange={onFile}
              disabled={isGenerating}
              style={{ display: 'none' }}
            />
            <svg style={{ width: '3rem', height: '3rem', marginBottom: '1rem', color: '#BBBBBB' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p style={{ fontSize: '1.125rem', fontWeight: 500, marginBottom: '0.5rem', color: '#555555' }}>
              Arrastra o haz clic para subir
            </p>
            <p style={{ fontSize: '0.875rem', color: '#888888' }}>PNG, JPG hasta 10MB</p>
          </div>
        </div>
      </div>
    </div>
  );

  /* ----- D) PANTALLA “GENERATING” ----- */
  const GeneratingScreen = () => (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      backgroundColor: '#F7F7F7',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem'
    }}>
      <Header />
      <div style={{ textAlign: 'center', gap: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ position: 'relative', width: '6rem', height: '6rem' }}>
          <div style={{
            width: '100%',
            height: '100%',
            backgroundColor: '#FF6200',
            borderRadius: '9999px',
            animation: 'pulse 1.5s infinite'
          }}></div>
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            border: '0.5rem solid #FFD1C1',
            borderTopColor: '#FF6200',
            borderRadius: '9999px',
            animation: 'spin 1s infinite linear'
          }}></div>
        </div>
        <div>
          <h2 style={{ fontSize: '1.875rem', fontWeight: 700, color: '#333333', marginBottom: '1rem' }}>
            Generando tu ilustración
          </h2>
          <p style={{ maxWidth: '28rem', color: '#666666' }}>
            Estamos analizando tu imagen y aplicando el estilo visual de ING...
          </p>
        </div>
        <div style={{
          background: '#ffffff',
          borderRadius: '1rem',
          padding: '1.5rem',
          boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
          maxWidth: '20rem',
          width: '100%'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.875rem', color: '#666666' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{
                width: '0.5rem',
                height: '0.5rem',
                backgroundColor: '#28A745',
                borderRadius: '9999px',
                animation: 'pulse 1.5s infinite'
              }}></div>
              <span>Analizando contenido</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{
                width: '0.5rem',
                height: '0.5rem',
                backgroundColor: '#FF6200',
                borderRadius: '9999px',
                animation: 'pulse 1.5s infinite'
              }}></div>
              <span>Seleccionando referencias</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{
                width: '0.5rem',
                height: '0.5rem',
                backgroundColor: '#6F42C1',
                borderRadius: '9999px',
                animation: 'pulse 1.5s infinite'
              }}></div>
              <span>Creando ilustración</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  /* ----- E) PANTALLA DE RESULTADO + ITERACIONES ----- */
  const ResultScreen = () => (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      backgroundColor: '#F7F7F7',
      padding: '2rem',
      gap: '2rem'
    }}>
      <Header />

      {/* IZQUIERDA */}
      <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{
          background: '#ffffff',
          borderRadius: '1rem',
          boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
          overflow: 'hidden'
        }}>
          <div style={{
            borderBottom: '1px solid #ECECEC',
            padding: '1rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#333333' }}>
              Tu ilustración ING
            </h2>
            <a
              href={resultUrl}
              download="ilustracion_ing.png"
              style={{
                backgroundColor: '#FF6200',
                color: '#ffffff',
                padding: '0.75rem 1.25rem',
                borderRadius: '0.75rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              <svg style={{ width: '1rem', height: '1rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Descargar
            </a>
          </div>
          <div style={{ background: '#F7F7F7', padding: '1rem', display: 'flex', justifyContent: 'center' }}>
            <img
              src={resultUrl}
              alt="Ilustración generada"
              style={{ width: '100%', borderRadius: '0.75rem', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}
            />
          </div>
        </div>

        {brandRefs.length > 0 && (
          <div style={{
            background: '#ffffff',
            borderRadius: '1rem',
            boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
            padding: '1rem'
          }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#333333', marginBottom: '0.75rem' }}>
              Referencias utilizadas
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(4rem, 1fr))', gap: '0.75rem' }}>
              {brandRefs.map((ref, index) => (
                <div key={index} style={{ textAlign: 'center' }}>
                  <img
                    src={ref.url}
                    alt={ref.title}
                    style={{ width: '100%', height: '4rem', objectFit: 'cover', borderRadius: '0.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}
                  />
                  <p style={{
                    fontSize: '0.75rem',
                    color: '#666666',
                    marginTop: '0.5rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {ref.title}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* DERECHA (ITERACIONES) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{
          background: '#ffffff',
          borderRadius: '1rem',
          boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
          padding: '1rem'
        }}>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#333333', marginBottom: '0.75rem' }}>
            Personalización
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <button
              onClick={() => {
                setShowColorOptions(!showColorOptions);
                setShowChatBox(false);
                setShowTitleOptions(false);
              }}
              disabled={isGenerating}
              style={{
                display: 'flex',
                alignItems: 'center',
                background: '#F7F7F7',
                borderRadius: '0.75rem',
                padding: '0.75rem',
                gap: '0.75rem',
                cursor: isGenerating ? 'not-allowed' : 'pointer',
                opacity: isGenerating ? 0.5 : 1
              }}
            >
              <div style={{
                width: '2.5rem',
                height: '2.5rem',
                background: 'linear-gradient(to right, #FF6200, #A855F7)',
                borderRadius: '0.5rem'
              }}></div>
              <div>
                <p style={{ fontWeight: 600, color: '#333333' }}>Cambiar colores</p>
                <p style={{ fontSize: '0.875rem', color: '#777777' }}>Paletas de ING</p>
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
                display: 'flex',
                alignItems: 'center',
                background: '#F7F7F7',
                borderRadius: '0.75rem',
                padding: '0.75rem',
                gap: '0.75rem',
                cursor: isGenerating ? 'not-allowed' : 'pointer',
                opacity: isGenerating ? 0.5 : 1
              }}
            >
              <div style={{
                width: '2.5rem',
                height: '2.5rem',
                background: '#EDE9FE',
                borderRadius: '0.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <svg style={{ width: '1.25rem', height: '1.25rem', color: '#7C3AED' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2m-9 0h10a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2z" />
                </svg>
              </div>
              <div>
                <p style={{ fontWeight: 600, color: '#333333' }}>Añadir título</p>
                <p style={{ fontSize: '0.875rem', color: '#777777' }}>Texto personalizado</p>
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
                display: 'flex',
                alignItems: 'center',
                background: '#F7F7F7',
                borderRadius: '0.75rem',
                padding: '0.75rem',
                gap: '0.75rem',
                cursor: isGenerating ? 'not-allowed' : 'pointer',
                opacity: isGenerating ? 0.5 : 1
              }}
            >
              <div style={{
                width: '2.5rem',
                height: '2.5rem',
                background: '#E0F2FE',
                borderRadius: '0.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <svg style={{ width: '1.25rem', height: '1.25rem', color: '#0284C7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div>
                <p style={{ fontWeight: 600, color: '#333333' }}>Modificar con IA</p>
                <p style={{ fontSize: '0.875rem', color: '#777777' }}>Instrucciones libres</p>
              </div>
            </button>
          </div>

          {/* Sub-menú “Cambiar colores” */}
          {showColorOptions && (
            <div style={{
              marginTop: '1rem',
              background: '#F7F7F7',
              borderRadius: '1rem',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem'
            }}>
              <p style={{ fontWeight: 600, color: '#333333', marginBottom: '0.5rem' }}>Paletas de colores</p>
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
                    display: 'flex',
                    alignItems: 'center',
                    background: '#ffffff',
                    borderRadius: '0.5rem',
                    padding: '0.75rem',
                    gap: '0.75rem',
                    border: '1px solid #E5E7EB',
                    cursor: isGenerating ? 'not-allowed' : 'pointer',
                    opacity: isGenerating ? 0.5 : 1
                  }}
                >
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {palette.colors.map((c, i) => (
                      <span key={i} style={{
                        width: '1rem',
                        height: '1rem',
                        background: c,
                        borderRadius: '9999px'
                      }}></span>
                    ))}
                  </div>
                  <span style={{
                    fontSize: '0.875rem',
                    color: '#555555',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {palette.name}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Sub-menú “Añadir título” */}
          {showTitleOptions && (
            <div style={{
              marginTop: '1rem',
              background: '#F7F7F7',
              borderRadius: '1rem',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem'
            }}>
              <p style={{ fontWeight: 600, color: '#333333', marginBottom: '0.5rem' }}>Opciones de título</p>
              <button
                onClick={() => iterate("add_title")}
                disabled={isGenerating}
                style={{
                  background: '#ffffff',
                  borderRadius: '0.5rem',
                  padding: '0.75rem',
                  textAlign: 'left',
                  border: '1px solid #E5E7EB',
                  cursor: isGenerating ? 'not-allowed' : 'pointer',
                  opacity: isGenerating ? 0.5 : 1
                }}
              >
                Escribir título personalizado
              </button>
              <button
                onClick={() => iterate("suggest_title")}
                disabled={isGenerating}
                style={{
                  background: '#ffffff',
                  borderRadius: '0.5rem',
                  padding: '0.75rem',
                  textAlign: 'left',
                  border: '1px solid #E5E7EB',
                  cursor: isGenerating ? 'not-allowed' : 'pointer',
                  opacity: isGenerating ? 0.5 : 1
                }}
              >
                Generar título con IA
              </button>
            </div>
          )}

          {/* Sub-menú “Modificar con IA” */}
          {showChatBox && (
            <div style={{
              marginTop: '1rem',
              background: '#F7F7F7',
              borderRadius: '1rem',
              padding: '1rem'
            }}>
              <p style={{ fontWeight: 600, color: '#333333', marginBottom: '0.5rem' }}>Modificar con IA</p>
              <textarea
                rows={3}
                maxLength={250}
                placeholder="Describe los cambios que quieres aplicar..."
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                disabled={isGenerating}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  border: '1px solid #E5E7EB',
                  resize: 'none',
                  fontFamily: 'inherit',
                  marginBottom: '0.5rem'
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: '#777777' }}>{chatText.length}/250 caracteres</span>
                <button
                  onClick={() => {
                    iterate("chat", chatText);
                    setShowChatBox(false);
                    setChatText("");
                  }}
                  disabled={isGenerating || !chatText.trim()}
                  style={{
                    background: '#0284C7',
                    color: '#ffffff',
                    padding: '0.5rem 1rem',
                    borderRadius: '0.5rem',
                    cursor: (isGenerating || !chatText.trim()) ? 'not-allowed' : 'pointer',
                    opacity: (isGenerating || !chatText.trim()) ? 0.5 : 1
                  }}
                >
                  Aplicar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Botón Regenerar imagen */}
        <div style={{
          background: '#ffffff',
          borderRadius: '1rem',
          boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
          padding: '1rem'
        }}>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#333333', marginBottom: '0.75rem' }}>
            Acciones
          </h3>
          <button
            onClick={generate}
            disabled={isGenerating}
            style={{
              background: '#FF6200',
              color: '#ffffff',
              width: '100%',
              padding: '0.75rem',
              borderRadius: '0.75rem',
              fontWeight: 600,
              cursor: isGenerating ? 'not-allowed' : 'pointer',
              opacity: isGenerating ? 0.5 : 1
            }}
          >
            Regenerar imagen
          </button>
        </div>

        {isGenerating && (
          <div style={{
            background: '#FFF8E1',
            borderRadius: '1rem',
            boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
            padding: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem'
          }}>
            <div style={{
              width: '1.5rem',
              height: '1.5rem',
              border: '0.25rem solid #FF6200',
              borderTopColor: 'transparent',
              borderRadius: '9999px',
              animation: 'spin 1s infinite linear'
            }}></div>
            <div>
              <span style={{ fontWeight: 600, color: '#FF8A00' }}>Procesando...</span>
              <p style={{ fontSize: '0.875rem', color: '#FF8A00', marginTop: '0.25rem' }}>
                Aplicando cambios, por favor espera.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  /* ----- F) SWITCH ENTRE PANTALLAS ----- */
  if (currentScreen === "welcome") return <WelcomeScreen />;
  if (currentScreen === "capture") return <CaptureScreen />;
  if (currentScreen === "generating") return <GeneratingScreen />;
  if (currentScreen === "result") return <ResultScreen />;

  return <WelcomeScreen />;
}

