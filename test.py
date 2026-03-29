import json
import os
from PIL import Image
import matplotlib.pyplot as plt
import numpy as np

# Cargar JSON
with open("datos.json", "r", encoding="utf-8") as f:
    data = json.load(f)

# Crear carpeta de salida
os.makedirs("outputs", exist_ok=True)

# Recorremos las imágenes en el JSON
for img_path, info in data.items():
    img_path = '/home/rensso/programs/anotador/public' + img_path
    print(img_path)

    # Abrir la imagen
    if not os.path.exists(img_path):
        print(f"⚠️ Imagen no encontrada: {img_path}")
        continue
    image = Image.open(img_path)

    # Mostrar y dibujar anotaciones
    plt.figure(figsize=(8, 6))
    plt.imshow(image)
    ax = plt.gca()

    for stroke in info.get("strokes", []):
        # Desnormalizar puntos
        pts = np.array(stroke["points"])
        if len(pts) > 0:
            pts[:, 0] = pts[:, 0] * image.width  # Escalar x al ancho de la imagen
            pts[:, 1] = pts[:, 1] * image.height  # Escalar y al alto de la imagen
            if len(pts) > 2:
                pts = np.vstack([pts, pts[0]])  # Cerrar polígono
            ax.plot(pts[:, 0], pts[:, 1], color="red", linewidth=2)
            ax.fill(pts[:, 0], pts[:, 1], color="red", alpha=0.3)

    plt.axis("off")
    plt.title(f"{img_path} - Peligrosa: {info.get('isDangerous')}")
    plt.show()
    plt.close()
