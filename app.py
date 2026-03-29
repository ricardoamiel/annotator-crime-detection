from flask import Flask, request
from flask_cors import CORS   # <--- importar
import json


app = Flask(__name__)
CORS(app)  # <--- habilitar CORS para todas las rutas

@app.route('/receive', methods=['POST'])
def receive():
    data = request.get_json()
    if data is None:
        return "No JSON recibido", 400
    print("Contenido recibido:", data)
    with open("datos.json", "w") as archivo_json:
        json.dump(data, archivo_json)

    return {"status": "ok", "data": data}, 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)



'''
curl -X POST http://127.0.0.1:5000/receive \
     -H "Content-Type: application/json" \
     -d '{"mensaje": "Hola desde Kubuntu"}'
'''
