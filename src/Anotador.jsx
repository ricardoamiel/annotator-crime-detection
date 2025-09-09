import React, { useEffect, useState, useRef } from "react";
import { FaTimes, FaSave, FaUndo } from "react-icons/fa";

export default function Anotador({ image, initialData, onSave, onCancel }) {
  const [isDangerous, setIsDangerous] = useState(false);
  const [notes, setNotes] = useState("");
  const [strokes, setStrokes] = useState([]); // [{ id: number, points: [[xNorm, yNorm]] }]
  const [isDrawing, setIsDrawing] = useState(false);
  const canvasRef = useRef(null);
  const imageRef = useRef(null);

  // Cargar datos iniciales
  useEffect(() => {
    setIsDangerous(initialData?.isDangerous ?? false);
    setNotes(initialData?.notes ?? "");
    setStrokes(initialData?.strokes ?? []);
  }, [initialData]);

  // Escape para cancelar
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") {
        setIsDrawing(false);
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  // Dibujar trazos rellenos
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const imgRect = imageRef.current.getBoundingClientRect();
    canvas.width = imgRect.width;
    canvas.height = imgRect.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach((stroke) => {
      ctx.beginPath();
      stroke.points.forEach((point, index) => {
        const x = point[0] * imgRect.width; // Desnormalizar para dibujar
        const y = point[1] * imgRect.height;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.closePath();
      ctx.fillStyle = "rgba(0, 0, 255, 0.5)"; // Azul semitransparente
      ctx.fill();
      ctx.strokeStyle = "blue";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    });
  }, [strokes]);

  // Manejo de eventos para dibujo
  const handleMouseDown = (e) => {
    const rect = imageRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const xNorm = x / rect.width; // Normalizar (0 a 1)
    const yNorm = y / rect.height;
    setIsDrawing(true);
    setStrokes((prev) => [
      ...prev,
      { id: Date.now(), points: [[xNorm, yNorm]] },
    ]);
  };

  const roundTo = (num, decimals) => {
    const factor = 10 ** decimals;
    return Math.round(num * factor) / factor;
  };

  const handleMouseMove = (e) => {
    if (!isDrawing) return;
    const rect = imageRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const xNorm = roundTo(Math.min(Math.max(x / rect.width, 0), 1), 5);
    const yNorm = roundTo(Math.min(Math.max(y / rect.height, 0), 1), 5);
    setStrokes((prev) => {
      const newStrokes = [...prev];
      const currentStroke = newStrokes[newStrokes.length - 1];
      currentStroke.points.push([xNorm, yNorm]);
      return newStrokes;
    });
  };

  const handleMouseUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
  };

  const handleMouseLeave = () => {
    if (isDrawing) {
      setIsDrawing(false);
    }
  };

  // Deshacer el último trazo
  const handleUndoStroke = () => {
    setStrokes((prev) => prev.slice(0, -1));
  };

  const handleSave = () => {
    onSave({ isDangerous, notes, strokes });
  };

  return (
    <div style={{
      width: "100vw", height: "100vh",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "#fafafa", padding: 20, boxSizing: "border-box"
    }}>
      <h2 style={{ marginBottom: 12 }}>Anotar imagen</h2>

      <div
        ref={imageRef}
        style={{
          width: "80%",
          maxWidth: 900,
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
          marginBottom: 18,
          position: "relative",
        }}
        onMouseLeave={handleMouseLeave}
      >
        <img
          src={image}
          alt="to-annotate"
          style={{ width: "100%", height: "60vh", objectFit: "cover", display: "block" }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            cursor: "crosshair",
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        />
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <button
          onClick={handleUndoStroke}
          disabled={strokes.length === 0}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #ccc",
            background: strokes.length === 0 ? "#f0f0f0" : "#fff",
            color: strokes.length === 0 ? "#999" : "#000",
            cursor: strokes.length === 0 ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
          aria-label="Deshacer último trazo"
        >
          <FaUndo size={18} /> Deshacer
        </button>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, cursor: "pointer" }}>
        <span>¿Es peligrosa la escena?</span>
        <div
          onClick={() => setIsDangerous(v => !v)}
          style={{
            width: 52,
            height: 30,
            borderRadius: 999,
            background: isDangerous ? "#de8282ff" : "#d1d5db",
            position: "relative",
            padding: 4,
            boxSizing: "border-box",
            transition: "background 0.2s",
          }}
        >
          <div style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
            position: "absolute",
            top: 4,
            left: isDangerous ? 26 : 4,
            transition: "left 0.18s",
          }} />
        </div>
      </label>

      <textarea
        placeholder="Describe por qué es peligrosa, qué elementos ves, contexto..."
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        style={{
          width: "80%",
          maxWidth: 800,
          height: 30,
          borderRadius: 8,
          padding: 12,
          border: "0.1px solid #ccc",
          fontSize: 15,
          resize: "vertical",
          marginBottom: 14,
        }}
      />

      <div style={{ display: "flex", gap: 12 }}>
        <button
          onClick={onCancel}
          title="Cancelar"
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #de8282ff",
            background: "#fff",
            color: "#de8282ff",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
          aria-label="Cancelar"
        >
          <FaTimes size={18} /> Cancelar
        </button>

        <button
          onClick={handleSave}
          title="Guardar"
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "none",
            background: isDangerous ? "#de8282ff" : "#549664ff",
            color: "#fff",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
          aria-label="Guardar"
        >
          <FaSave size={18} /> Guardar
        </button>
      </div>
    </div>
  );
}