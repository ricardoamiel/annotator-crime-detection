import React, { useEffect, useState } from "react";
import { FiArrowLeft, FiArrowRight, FiSettings } from "react-icons/fi";
import { FaPencilAlt, FaDownload } from "react-icons/fa";
import Anotador from "./Anotador";

const ROWS = 2;
const COLS = 3;

export default function App() {
  const [images, setImages] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [popupImage, setPopupImage] = useState(null);
  const [annotations, setAnnotations] = useState({});
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState("grid");

  const imagesPerPage = ROWS * COLS;
  const totalPages = Math.max(1, Math.ceil(images.length / imagesPerPage));

  // Cargar imágenes desde JSON
  useEffect(() => {
    const loadImages = async () => {
      try {
        const res = await fetch("/imgs/imgs.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}: No se pudo cargar imgs.json`);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("imgs.json debe ser un arreglo de nombres de imágenes");
        const shuffled = data
          .map((item) => ({ item, sort: Math.random() }))
          .sort((a, b) => a.sort - b.sort)
          .map(({ item }) => item);
        setImages(shuffled);
        console.log("Imágenes cargadas:", shuffled);
      } catch (err) {
        console.error("Error cargando JSON:", err);
        alert("Error al cargar las imágenes. Verifica que public/imgs/imgs.json exista.");
      }
    };
    loadImages();
  }, []);

  // Cargar anotaciones desde localStorage
  useEffect(() => {
    const savedAnnotations = localStorage.getItem("annotations");
    if (savedAnnotations) {
      try {
        setAnnotations(JSON.parse(savedAnnotations));
        console.log("Anotaciones cargadas desde localStorage:", JSON.parse(savedAnnotations));
      } catch (err) {
        console.error("Error cargando anotaciones de localStorage:", err);
      }
    }
  }, []);

  // Guardar anotaciones en localStorage
  useEffect(() => {
    try {
      localStorage.setItem("annotations", JSON.stringify(annotations));
      console.log("Anotaciones guardadas en localStorage:", annotations);
    } catch (err) {
      console.error("Error guardando en localStorage:", err);
    }
  }, [annotations]);

  // Cerrar popup con Escape
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") {
        if (popupImage) setPopupImage(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [popupImage]);

  const handleNext = () => { if (page < totalPages - 1) setPage(page + 1); };
  const handlePrev = () => { if (page > 0) setPage(page - 1); };

  // Abrir anotador
  const handleOpenAnnotator = () => {
    if (!selectedImage) {
      alert("Selecciona una imagen primero.");
      return;
    }
    console.log("Abriendo anotador para:", selectedImage);
    setPopupImage(null);
    setMode("annotator");
  };

  // Guardar anotación
  const handleSaveAnnotation = (imgPath, data) => {
    console.log("Guardando anotación para:", imgPath, data);
    setAnnotations((prev) => ({
      ...prev,
      [imgPath]: {
        isDangerous: data.isDangerous,
        notes: data.notes || "",
        strokes: data.strokes || [],
      },
    }));
    setMode("grid");
    setSelectedImage(null);
    setPopupImage(null);
  };

  // Cancelar anotador
  const handleCancelAnnotator = () => {
    setMode("grid");
  };

  // Enviar anotaciones al servidor (desactivado hasta configurar el servidor)
  const handleExportAnnotations = async () => {
    //alert("Configura un servidor (Flask o json-server) para enviar anotaciones.");
    console.log("Anotaciones que se enviarían:", annotations);
    // Descomenta cuando configures el servidor
    
    if (Object.keys(annotations).length === 0) {
      alert("No hay anotaciones para enviar.");
      return;
    }
    try {
      const API_URL = "http://127.0.0.1:5000/receive"; // Cambia según tu servidor
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(annotations),
      });
      if (response.ok) {
        alert("Anotaciones enviadas al servidor con éxito.");
      } else {
        const errorText = await response.text();
        console.error(`Error del servidor: ${response.status} ${errorText}`);
        alert(`Error al enviar anotaciones: ${response.status} ${errorText}`);
      }
    } catch (err) {
      console.error("Error de red:", err);
      alert(`Error de conexión al servidor: ${err.message}`);
    }
    
  };

  if (mode === "annotator" && selectedImage) {
    return (
      <Anotador
        image={selectedImage}
        initialData={annotations[selectedImage]}
        onSave={(data) => handleSaveAnnotation(selectedImage, data)}
        onCancel={handleCancelAnnotator}
      />
    );
  }

  const startIdx = page * imagesPerPage;
  const currentImages = images.slice(startIdx, startIdx + imagesPerPage);

  return (
    <div style={{
      width: "100vw",
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      background: "#f0f0f0",
      padding: "20px",
    }}>
      <h1>Anotador</h1>

      {/* Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${COLS}, 200px)`,
        gridTemplateRows: `repeat(${ROWS}, 200px)`,
        gap: "20px",
        justifyContent: "center",
        alignItems: "center",
      }}>
        {currentImages.map((src, idx) => {
          const imgPath = `/imgs/${src}`;
          const ann = annotations[imgPath];

          let boxShadow = "0 0 12px 3px #66657dff"; // gris inicial
          if (ann?.isDangerous === true) boxShadow = "0 0 15px 4px #FF8C94"; // rojo pastel
          else if (ann?.isDangerous === false) boxShadow = "0 0 15px 4px #A8E6CF"; // verde pastel
          else if (selectedImage === imgPath) boxShadow = "0 0 15px 4px #FFD580"; // naranja pastel

          return (
            <div
              key={idx}
              style={{
                width: "200px",
                height: "200px",
                borderRadius: "12px",
                overflow: "hidden",
                cursor: "pointer",
                boxShadow,
                transition: "box-shadow 0.25s, transform 0.15s",
              }}
              onClick={() => {
                setSelectedImage(imgPath);
                setPopupImage(imgPath);
              }}
            >
              <img
                src={imgPath}
                alt={`img-${startIdx + idx + 1}`}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </div>
          );
        })}
      </div>

      {/* Botones */}
      <div style={{ marginTop: "20px", display: "flex", gap: "12px" }}>
        <button onClick={handlePrev} disabled={page === 0} style={{ padding: "8px 12px" }}>
          <FiArrowLeft size={18} />
        </button>

        <button
          onClick={handleOpenAnnotator}
          disabled={!selectedImage}
          title={!selectedImage ? "Selecciona una imagen primero" : "Abrir anotador"}
          style={{ padding: "8px 12px" }}
        >
          <FaPencilAlt size={18} />
        </button>

        <button onClick={() => alert("Abrir ayuda/configuración")} style={{ padding: "8px 12px" }}>
          <FiSettings size={18} />
        </button>

        <button onClick={handleNext} disabled={page >= totalPages - 1} style={{ padding: "8px 12px" }}>
          <FiArrowRight size={18} />
        </button>

        <button
          onClick={handleExportAnnotations}
          disabled={Object.keys(annotations).length === 0}
          title="Enviar anotaciones al servidor"
          style={{ padding: "8px 12px" }}
        >
          <FaDownload size={18} />
        </button>
      </div>

      {/* Saltar a página */}
      <div style={{ marginTop: "14px", display: "flex", alignItems: "center", gap: "10px" }}>
        <span>Página {page + 1} / {totalPages}</span>
        <input
          type="number"
          min={1}
          max={totalPages}
          placeholder="Ir a"
          style={{
            width: "60px",
            textAlign: "center",
            backgroundColor: "#e9ecef",
            color: "black",
            border: "1px solid #ccc",
            borderRadius: "6px",
            padding: "4px",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const p = Math.min(Math.max(Number(e.target.value) - 1 || 0, 0), totalPages - 1);
              setPage(p);
              e.target.value = "";
            }
          }}
        />
      </div>

      {/* Popup */}
      {popupImage && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setPopupImage(null); }}
          style={{
            position: "fixed",
            top: 0, left: 0, width: "100vw", height: "100vh",
            background: "rgba(0,0,0,0.7)",
            display: "flex", justifyContent: "center", alignItems: "center",
            zIndex: 2000
          }}
        >
          <img src={popupImage} alt="Seleccionada" style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 12 }} />
        </div>
      )}
    </div>
  );
}