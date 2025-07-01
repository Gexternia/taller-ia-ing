import { useState, useCallback, useMemo } from "react";
import {
  Upload,
  Download,
  Palette,
  Type,
  MessageSquare,
  Home,
  Camera,
  Layers,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const ModifyAITextarea = ({ onSubmit, isGenerating }) => {
  const [localText, setLocalText] = useState("");

  const handleSubmit = () => {
    if (localText.trim()) {
      onSubmit(localText);
      setLocalText("");
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Card className="mt-4 bg-white/90 backdrop-blur-sm border-0 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-purple-500" />
          Modify with AI
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <textarea
          rows={3}
          maxLength={250}
          placeholder="Describe the changes you want to apply…"
          value={localText}
          onChange={(e) => setLocalText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isGenerating}
          className="w-full p-3 border border-gray-200 rounded-lg resize-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          autoFocus
        />
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-500">
            {localText.length}/250 chars
          </span>
          <Button
            onClick={handleSubmit}
            disabled={isGenerating || !localText.trim()}
            className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
          >
            Apply
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

const Index = () => {
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
  const [currentScreen, setCurrentScreen] = useState("welcome");
  const [mode, setMode] = useState("pintor");
  const [artist, setArtist] = useState("");
  const painterOptions = [
    { key: "picasso", label: "Arte Picasso" },
    { key: "salvador dali", label: "Arte Dalí" },
    { key: "diego velazquez", label: "Arte Velázquez" },
    { key: "joaquin sorolla", label: "Arte Sorolla" },
  ];
  const painterRefs = {
    picasso: {
      label: "Arte Picasso",
      img: "./picasso.png",
    },
    "salvador dali": {
      label: "Arte Dalí",
      img: "./dali.png",
    },
    "diego velazquez": {
      label: "Arte Velázquez",
      img: "./Velazquez.png",
    },
    "joaquin sorolla": {
      label: "Arte Sorolla",
      img: "./Sorolla.png",
    },
  };

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
    setCurrentScreen("welcome");
  }, []);

  const generate = useCallback(async () => {
    if (!captured) return;
    setIsGenerating(true);
    setCurrentScreen("generating");
    const form = new FormData();
    form.append("image", captured);
    form.append("mode", mode);
    if (mode === "pintor") form.append("artist", artist); // <-- Añadir esto

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
  }, [captured, mode, artist]);

  const iterate = useCallback(
    async (action, param = null) => {
      if (!responseId || !imageCallId) {
        alert("Primero genera la imagen inicial");
        return;
      }
      setIsGenerating(true);

      const payload: any = {
        previousResponseId: responseId,
        imageCallId,
        action,
        originalDescription: { text: originalDescription, prevImageUrl },
      };
      if (param) payload.actionParam = param;

      try {
        if (action === "suggest_title") {
          const res = await fetch("/api/iterate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const { suggestedTitle, error } = await res.json();
          if (error) throw new Error(error);
          const userTitle = window.prompt(
            "¿Te gusta este título? Edítalo si quieres:",
            suggestedTitle
          );
          if (userTitle) {
            await iterate("add_title", userTitle);
          }
          return;
        }

        if (action === "add_title" && !param) {
          const userTitle = window.prompt(
            "Escribe el título que quieres añadir:"
          );
          if (!userTitle) return;
          param = userTitle;
          payload.actionParam = param;
        }

        const res = await fetch("/api/iterate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
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
      } catch (err) {
        console.error("iterate error:", err);
        alert("Error en iteración: " + err.message);
      } finally {
        setIsGenerating(false);
      }
    },
    [responseId, imageCallId, originalDescription, prevImageUrl]
  );

  const handleChatSubmit = useCallback(
    (chatText) => {
      iterate("chat", chatText);
      setShowChatBox(false);
    },
    [iterate]
  );

  const handleDownload = useCallback(async () => {
    if (!resultUrl) return;

    try {
      const downloadUrl = `/api/download-image?url=${encodeURIComponent(
        resultUrl
      )}`;
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `artforge_ai_${Date.now()}.png`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Error downloading image:", error);
      alert("Error al descargar la imagen. Por favor, inténtalo de nuevo.");
    }
  }, [resultUrl]);

  const Header = useMemo(
    () => () => {
      const [open, setOpen] = useState(false);

      return (
        <header className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-gray-100">
          <div className="max-w-7xl mx-auto flex items-center justify-between px-3 py-2 md:px-6">
            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={resetApp}
            >
              <img
                src="/Externia.jpeg"
                alt="Logo"
                className="w-10 h-10 object-contain"
              />
              <span className="text-xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
                SmartBrush
              </span>
            </div>

            {/* Hamburguesa visible sólo en móvil */}
            <button
              className="md:hidden p-2 rounded focus:outline-none focus:ring-2 focus:ring-purple-400"
              onClick={() => setOpen((v) => !v)}
              aria-label="Abrir menú"
              type="button"
            >
              <svg
                className="w-7 h-7 text-gray-700"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d={open ? "M6 18L18 6M6 6l12 12" : "M4 8h16M4 16h16"}
                />
              </svg>
            </button>

            {/* Menú horizontal en desktop, vertical flotante en móvil */}
            <nav
              className={`
                flex-col md:flex-row md:flex items-center md:space-x-2
                absolute md:static bg-white/95 md:bg-transparent left-0 right-0 top-16 md:top-0 shadow-md md:shadow-none transition-all z-40
                ${open ? "flex" : "hidden md:flex"}
              `}
            >
              <Button
                variant={currentScreen === "welcome" ? "default" : "ghost"}
                onClick={() => {
                  setCurrentScreen("welcome");
                  setOpen(false);
                }}
                className={
                  currentScreen === "welcome"
                    ? "bg-gradient-to-r from-orange-400 to-pink-500"
                    : "md:bg-none w-full md:w-auto"
                }
              >
                <Home className="w-4 h-4 mr-2" />
                <span>Home</span>
              </Button>
              <Button
                variant={
                  currentScreen === "capture" && mode === "pintor"
                    ? "default"
                    : "ghost"
                }
                onClick={() => {
                  setMode("pintor");
                  setArtist("");
                  setCurrentScreen("capture");
                  setOpen(false);
                }}
                className={
                  currentScreen === "capture" && mode === "pintor"
                    ? "bg-gradient-to-r from-orange-400 to-purple-500 text-white font-medium"
                    : "md:bg-none w-full md:w-auto"
                }
              >
                <span
                  className={
                    currentScreen === "capture" && mode === "pintor"
                      ? "text-white font-medium"
                      : "bg-gradient-to-r from-orange-400 to-purple-500 bg-clip-text text-transparent font-medium"
                  }
                >
                  Pintor
                </span>
              </Button>
              <Button
                variant={
                  currentScreen === "capture" && mode === "caricature"
                    ? "default"
                    : "ghost"
                }
                onClick={() => {
                  setMode("caricature");
                  setCurrentScreen("capture");
                  setOpen(false);
                }}
                className={
                  currentScreen === "capture" && mode === "caricature"
                    ? "bg-gradient-to-r from-green-500 to-blue-500 text-white font-medium"
                    : "md:bg-none w-full md:w-auto"
                }
              >
                <span
                  className={
                    currentScreen === "capture" && mode === "caricature"
                      ? "text-white font-medium"
                      : "text-gray-600"
                  }
                >
                  Caricatura
                </span>
              </Button>
            </nav>
          </div>
        </header>
      );
    },
    [currentScreen, resetApp, mode, setCurrentScreen, setMode, setArtist]
  );

  const WelcomeScreen = useCallback(
    () => (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-orange-50">
        <Header />
        <div className="pt-20 px-6">
          <div className="max-w-7xl mx-auto">
            {/* Hero Section */}
            <div className="text-center py-20">
              <h1 className="text-6xl font-bold mb-6">
                <span className="bg-gradient-to-r from-orange-400 via-purple-500 to-pink-500 bg-clip-text text-transparent">
                  Transforma tus imágenes
                </span>
                <br />
                <span className="text-gray-800">en obras maestras</span>
              </h1>
              <p className="text-xl text-gray-600 mb-12 max-w-3xl mx-auto">
                Utiliza el poder de la inteligencia artificial para convertir
                tus fotografías en increíbles obras de arte al estilo de Picasso
                o en divertidas caricaturas personalizadas.
              </p>

              {/* Feature Cards */}
              <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto mb-16">
                <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-xl hover:shadow-2xl transition-all duration-300 group">
                  <CardContent className="p-8">
                    <div className="w-16 h-16 bg-gradient-to-br from-orange-400 to-purple-500 rounded-full flex items-center justify-center mb-6 mx-auto group-hover:scale-110 transition-transform">
                      <Sparkles className="w-8 h-8 text-white" />
                    </div>
                    <h3 className="text-2xl font-bold text-gray-800 mb-4">
                      Estilo Pintor
                    </h3>
                    <p className="text-gray-600 mb-6">
                      Convierte tus imágenes en obras inspiradas en artistas
                      legendarios como Picasso, Dalí, Velázquez o Sorolla.
                      ¡Elige tu pintor favorito!
                    </p>
                    <Button
                      className="w-full bg-gradient-to-r from-orange-400 to-purple-500 hover:from-orange-500 hover:to-purple-600 text-white font-medium py-3"
                      onClick={() => {
                        setMode("pintor");
                        setArtist(""); // Reset artista
                        setCurrentScreen("capture");
                      }}
                    >
                      Crear Arte de Pintor
                    </Button>
                  </CardContent>
                </Card>

                <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-xl hover:shadow-2xl transition-all duration-300 group">
                  <CardContent className="p-8">
                    <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-blue-500 rounded-full flex items-center justify-center mb-6 mx-auto group-hover:scale-110 transition-transform">
                      <svg
                        className="w-8 h-8 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1a3 3 0 000-6h-1m4 6V4a3 3 0 000-6M15 10h1a3 3 0 000-6h-1m-4 6v6m4-6v6"
                        />
                      </svg>
                    </div>
                    <h3 className="text-2xl font-bold text-gray-800 mb-4">
                      Caricatura
                    </h3>
                    <p className="text-gray-600 mb-6">
                      Crea divertidas caricaturas con características exageradas
                      pero manteniendo la esencia reconocible del sujeto.
                    </p>
                    <Button
                      className="w-full bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 text-white font-medium py-3"
                      onClick={() => {
                        setMode("caricature");
                        setCurrentScreen("capture");
                      }}
                    >
                      Crear Caricatura
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    []
  );

  const CaptureScreen = useCallback(
    () => (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-orange-50">
        <Header />
        <div className="pt-20 px-6">
          <div className="max-w-6xl mx-auto py-12">
            <div className="text-center mb-12">
              <Badge
                className={`mb-4 text-white ${
                  mode === "pintor"
                    ? "bg-gradient-to-r from-orange-400 to-purple-500"
                    : "bg-gradient-to-r from-green-500 to-blue-500"
                }`}
              >
                {mode === "pintor" ? "Estilo Pintor" : "Estilo Caricatura"}
              </Badge>
              <h2 className="text-4xl font-bold text-gray-800 mb-4">
                {mode === "pintor"
                  ? "Elige tu pintor favorito"
                  : "Estilo Caricatura"}
              </h2>
              <p className="text-xl text-gray-600">
                {mode === "pintor"
                  ? "Transforma tu imagen en una obra al estilo del pintor seleccionado."
                  : "Crea tu caricatura personalizada"}
              </p>
            </div>

            <div className="grid lg:grid-cols-2 gap-12 items-center">
              {/* Left side - Info or inspiration */}
              <div className="space-y-6">
                <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-xl">
                  <CardContent className="p-8">
                    <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg aspect-video mb-6 flex items-center justify-center">
                      <div className="text-gray-600 text-center">
                        {mode === "pintor" ? (
                          artist && painterRefs[artist] ? (
                            <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg aspect-video mb-6 flex items-center justify-center">
                              <div className="text-gray-600 text-center">
                                <img
                                  src={painterRefs[artist].img}
                                  alt={painterRefs[artist].label}
                                  className="max-h-56 max-w-full rounded-lg shadow-lg mx-auto mb-2"
                                />
                                <div className="text-sm text-gray-700 mt-1">
                                  {painterRefs[artist].desc}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg aspect-video mb-6 flex items-center justify-center">
                              <div className="text-gray-400 text-center p-10">
                                Elige un pintor para ver una obra de referencia.
                              </div>
                            </div>
                          )
                        ) : (
                          <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg aspect-video mb-6 flex items-center justify-center">
                            <div className="text-gray-600 text-center">
                              <img
                                src="./Caricatura.png"
                                alt="Ejemplo de caricatura"
                                className="w-full h-full object-cover rounded-lg"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <p className="text-gray-600">
                      {mode === "picasso"
                        ? "El estilo cubista revolucionó el arte con formas geométricas y perspectivas múltiples"
                        : "Las caricaturas exageran características faciales de manera divertida y reconocible"}
                    </p>
                    {mode === "pintor" && (
                      <div className="flex flex-col gap-3 mt-6">
                        {painterOptions.map((p) => (
                          <Button
                            key={p.key}
                            variant={artist === p.key ? "default" : "outline"}
                            onClick={() => setArtist(p.key)}
                            className={`w-full text-lg ${
                              artist === p.key
                                ? "bg-gradient-to-r from-orange-400 to-purple-500 text-white"
                                : ""
                            }`}
                          >
                            {p.label}
                          </Button>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Right side - Upload */}
              <div className="space-y-6">
                <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-xl">
                  <CardHeader>
                    <CardTitle className="text-center">
                      Sube tu imagen
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div
                      className={`border-2 border-dashed rounded-xl p-12 text-center hover:border-orange-400 transition-colors ${
                        mode === "picasso"
                          ? "border-orange-300"
                          : "border-green-300 hover:border-green-400"
                      }`}
                    >
                      {captured ? (
                        <div className="space-y-4">
                          <img
                            src={URL.createObjectURL(captured)}
                            alt="Preview"
                            className="max-w-full max-h-64 mx-auto rounded-lg shadow-lg"
                          />
                          <label
                            htmlFor="file-upload"
                            className="inline-flex items-center px-6 py-3 ..."
                          >
                            <Camera className="w-5 h-5 mr-2" />
                            Tomar foto / Subir
                          </label>
                        </div>
                      ) : (
                        <div>
                          <Upload
                            className={`w-16 h-16 mx-auto mb-4 ${
                              mode === "picasso"
                                ? "text-orange-400"
                                : "text-green-400"
                            }`}
                          />
                          <p className="text-xl font-medium text-gray-700 mb-2">
                            Arrastra tu imagen aquí
                          </p>
                          <p className="text-gray-500 mb-6">
                            o haz clic para seleccionar
                          </p>
                          <label
                            htmlFor="file-upload"
                            className={`inline-flex items-center px-6 py-3 text-white rounded-lg cursor-pointer transition-all ${
                              mode === "picasso"
                                ? "bg-gradient-to-r from-orange-400 to-purple-500 hover:from-orange-500 hover:to-purple-600"
                                : "bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600"
                            }`}
                          >
                            <Camera className="w-5 h-5 mr-2" />
                            Tomar foto / Subir
                          </label>
                        </div>
                      )}
                      <input
                        id="file-upload"
                        type="file"
                        accept="image/*"
                        onChange={(e) => setCaptured(e.target.files[0])}
                        className="hidden"
                        disabled={isGenerating}
                      />
                    </div>

                    <Button
                      onClick={generate}
                      disabled={
                        isGenerating ||
                        !captured ||
                        (mode === "pintor" && !artist)
                      }
                      className={`w-full py-4 text-lg disabled:opacity-50 ${
                        mode === "pintor"
                          ? "bg-gradient-to-r from-orange-400 to-purple-500 hover:from-orange-500 hover:to-purple-600"
                          : "bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600"
                      }`}
                    >
                      {isGenerating ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                          Generando...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-5 h-5 mr-2" />
                          Crear arte
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    [captured, isGenerating, generate, mode]
  );

  const GeneratingScreen = useCallback(
    () => (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-orange-50 flex items-center justify-center">
        <Header />
        <Card className="bg-white/90 backdrop-blur-sm border-0 shadow-2xl p-12 text-center max-w-md mx-6">
          <div className="w-20 h-20 mx-auto mb-8 relative">
            <div className="absolute inset-0 bg-gradient-to-r from-orange-400 via-purple-500 to-pink-500 rounded-full animate-spin"></div>
            <div className="absolute inset-2 bg-white rounded-full flex items-center justify-center">
              <Sparkles className="w-8 h-8 text-purple-500" />
            </div>
          </div>
          <h2 className="text-3xl font-bold text-gray-800 mb-4">
            Generando tu ilustración...
          </h2>
          <p className="text-gray-600 text-lg">
            Estamos analizando y aplicando el estilo artístico.
          </p>
        </Card>
      </div>
    ),
    []
  );

  // const ColorPalettesMenu = useCallback(() => {
  //   const palettes = [
  //     {
  //       name: "Orange + Sky + Maroon + Blush",
  //       colors: ["#FF6200", "#89D6FD", "#4D0020", "#F689FD"],
  //     },
  //     {
  //       name: "Orange + Maroon + Raspberry + Blush",
  //       colors: ["#FF6200", "#4D0020", "#D40199", "#F689FD"],
  //     },
  //     {
  //       name: "Orange + Raspberry + Blush + Sun",
  //       colors: ["#FF6200", "#D40199", "#F689FD", "#FFE100"],
  //     },
  //     {
  //       name: "Orange + Violet + Sky + Maroon",
  //       colors: ["#FF6200", "#7724FF", "#89D6FD", "#4D0020"],
  //     },
  //   ];

  //   return (
  //     <Card className="mt-4 bg-white/90 backdrop-blur-sm border-0 shadow-lg">
  //       <CardHeader className="pb-3">
  //         <CardTitle className="text-lg flex items-center gap-2">
  //           <Palette className="w-5 h-5 text-orange-500" />
  //           Paletas de colores
  //         </CardTitle>
  //       </CardHeader>
  //       <CardContent className="space-y-3">
  //         {palettes.map((palette, idx) => (
  //           <button
  //             key={idx}
  //             onClick={() => iterate("change_palette", palette.colors.join(", "))}
  //             disabled={isGenerating}
  //             className="w-full p-4 rounded-lg border border-gray-200 hover:border-orange-300 hover:bg-orange-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
  //           >
  //             <div className="flex items-center space-x-3">
  //               <div className="flex space-x-1">
  //                 {palette.colors.map((color, i) => (
  //                   <div
  //                     key={i}
  //                     className="w-6 h-6 rounded-full border-2 border-white shadow-sm"
  //                     style={{ backgroundColor: color }}
  //                   />
  //                 ))}
  //               </div>
  //               <span className="text-sm font-medium text-gray-700">{palette.name}</span>
  //             </div>
  //           </button>
  //         ))}
  //       </CardContent>
  //     </Card>
  //   );
  // }, [iterate, isGenerating]);

  // const TitleOptionsMenu = useCallback(
  //   () => (
  //     <Card className="mt-4 bg-white/90 backdrop-blur-sm border-0 shadow-lg">
  //       <CardHeader className="pb-3">
  //         <CardTitle className="text-lg flex items-center gap-2">
  //           <Type className="w-5 h-5 text-pink-500" />
  //           Opciones de título
  //         </CardTitle>
  //       </CardHeader>
  //       <CardContent className="space-y-3">
  //         <Button
  //           onClick={() => iterate("add_title")}
  //           disabled={isGenerating}
  //           variant="outline"
  //           className="w-full justify-start hover:bg-pink-50 hover:border-pink-300"
  //         >
  //           Título personalizado
  //         </Button>
  //         <Button
  //           onClick={() => iterate("suggest_title")}
  //           disabled={isGenerating}
  //           variant="outline"
  //           className="w-full justify-start hover:bg-pink-50 hover:border-pink-300"
  //         >
  //           Título generado por IA
  //         </Button>
  //       </CardContent>
  //     </Card>
  //   ),
  //   [iterate, isGenerating]
  // );

  const ResultScreen = () => (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-orange-50">
      <Header />
      <div className="pt-20 px-6">
        <div className="max-w-7xl mx-auto py-8">
          <div className="grid lg:grid-cols-3 gap-8">
            {/* Main Result - Left Side */}
            <div className="lg:col-span-2 space-y-6">
              <Card className="bg-white/90 backdrop-blur-sm border-0 shadow-xl">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-2xl">Tu obra maestra</CardTitle>
                  <Button
                    onClick={handleDownload}
                    disabled={!resultUrl}
                    className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Descargar
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="bg-gray-100 rounded-xl p-4">
                    {resultUrl && (
                      <img
                        src={resultUrl}
                        alt="Ilustración generada"
                        className="w-full h-auto rounded-lg shadow-lg"
                      />
                    )}
                  </div>
                </CardContent>
              </Card>

              {brandRefs.length > 0 && (
                <Card className="bg-white/90 backdrop-blur-sm border-0 shadow-xl">
                  <CardHeader>
                    <CardTitle>Referencias</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {brandRefs.map((ref, index) => (
                        <div key={index} className="space-y-2">
                          <img
                            src={ref.url}
                            alt={ref.title}
                            className="w-full h-32 object-cover rounded-lg"
                          />
                          <p className="text-sm text-gray-600 text-center">
                            {ref.title}
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Controls - Right Side */}
            <div className="space-y-6">
              {/* <Card className="bg-white/90 backdrop-blur-sm border-0 shadow-xl">
                <CardHeader>
                  <CardTitle>Personalización</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button
                    onClick={() => {
                      setShowColorOptions(!showColorOptions);
                      setShowChatBox(false);
                      setShowTitleOptions(false);
                    }}
                    disabled={isGenerating}
                    variant="outline"
                    className="w-full justify-start hover:bg-orange-50 hover:border-orange-300"
                  >
                    <Palette className="w-4 h-4 mr-2 text-orange-500" />
                    <div className="text-left">
                      <div className="font-medium">Cambiar colores</div>
                      <div className="text-sm text-gray-500">
                        Paletas predefinidas
                      </div>
                    </div>
                  </Button>

                  <Button
                    onClick={() => {
                      setShowTitleOptions(!showTitleOptions);
                      setShowColorOptions(false);
                      setShowChatBox(false);
                    }}
                    disabled={isGenerating}
                    variant="outline"
                    className="w-full justify-start hover:bg-pink-50 hover:border-pink-300"
                  >
                    <Type className="w-4 h-4 mr-2 text-pink-500" />
                    <div className="text-left">
                      <div className="font-medium">Agregar título</div>
                      <div className="text-sm text-gray-500">
                        Texto personalizado
                      </div>
                    </div>
                  </Button>

                  <Button
                    onClick={() => {
                      setShowChatBox(!showChatBox);
                      setShowColorOptions(false);
                      setShowTitleOptions(false);
                    }}
                    disabled={isGenerating}
                    variant="outline"
                    className="w-full justify-start hover:bg-purple-50 hover:border-purple-300"
                  >
                    <MessageSquare className="w-4 h-4 mr-2 text-purple-500" />
                    <div className="text-left">
                      <div className="font-medium">Modificar con IA</div>
                      <div className="text-sm text-gray-500">
                        Instrucciones personalizadas
                      </div>
                    </div>
                  </Button>
                </CardContent>
              </Card> */}

              {/* {showColorOptions && <ColorPalettesMenu />}
              {showTitleOptions && <TitleOptionsMenu />} */}
              {showChatBox && (
                <ModifyAITextarea
                  onSubmit={handleChatSubmit}
                  isGenerating={isGenerating}
                />
              )}

              <Card className="bg-white/90 backdrop-blur-sm border-0 shadow-xl">
                <CardHeader>
                  <CardTitle>Acciones</CardTitle>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={generate}
                    disabled={isGenerating}
                    className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Regenerar imagen
                  </Button>
                </CardContent>
              </Card>

              {isGenerating && (
                <Card className="bg-white/90 backdrop-blur-sm border-0 shadow-xl">
                  <CardContent className="pt-6">
                    <div className="flex items-center space-x-3">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
                      <div>
                        <div className="font-medium text-gray-800">
                          Procesando...
                        </div>
                        <div className="text-sm text-gray-500">
                          Aplicando cambios, por favor espera.
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (currentScreen === "welcome") return <WelcomeScreen />;
  if (currentScreen === "capture") return <CaptureScreen />;
  if (currentScreen === "generating") return <GeneratingScreen />;
  if (currentScreen === "result") return <ResultScreen />;

  return <WelcomeScreen />;
};

export default Index;
