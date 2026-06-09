"""
Batch Annotation Server  v2 — Multi-Rater / Inter-Rater Reliability
=====================================================================
Supports two deployment modes, set via DEPLOY_MODE env var:

  LOCAL  (default)
    - TARGET_RESPONSES = 1   (you are the only annotator)
    - Session identity comes from LOCAL_SESSION env var (a fixed name
      you set once), NOT from the browser.  Survives browser clears,
      incognito tabs, different browsers — as long as Flask is running
      on the same machine.
    - Progress is purely server-side (server_data/).

  DEPLOYED
    - TARGET_RESPONSES = N   (multiple annotators)
    - Session identity comes from the browser (localStorage UUID).
    - Each annotator gets their own session; same batch is answered
      by TARGET_RESPONSES different people.

Switch modes:
    DEPLOY_MODE=local    python app.py      ← solo local work
    DEPLOY_MODE=deployed python app.py      ← shared deployment

Data layout (same in both modes):
  server_data/
    batches.json    — batch manifest (images, fixed forever)
    responses.json  — { batch_id: { session_id: { annotations } } }
    annotators.json — { session_id: { alias, completed_batches, ... } }
"""

import os, json, glob, time, random, threading
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ──────────────────────────────────────────────────────────
# MODE DETECTION
# ──────────────────────────────────────────────────────────
DEPLOY_MODE = os.environ.get("DEPLOY_MODE", "local").lower()
IS_LOCAL    = DEPLOY_MODE == "local"

# In local mode, the session is fixed to this value.
# Change it to your name so your annotations are labelled clearly.
LOCAL_SESSION_ID    = os.environ.get("LOCAL_SESSION", "local_annotator")
LOCAL_SESSION_ALIAS = os.environ.get("LOCAL_ALIAS",   "Local Annotator")

# ──────────────────────────────────────────────────────────
# CONFIG
# ──────────────────────────────────────────────────────────
BATCH_SIZE       = 32
TARGET_RESPONSES = 1 if IS_LOCAL else int(os.environ.get("TARGET_RESPONSES", "3"))
CLAIM_TTL        = 2 * 3600
##DATA_DIR         = Path("server_data")
DATA_DIR = Path(os.environ.get("DATA_DIR", "server_data"))
BATCHES_FILE     = DATA_DIR / "batches.json"
RESPONSES_FILE   = DATA_DIR / "responses.json"
ANNOTATORS_FILE  = DATA_DIR / "annotators.json"
IMAGES_ROOT      = Path(os.environ.get("IMAGES_ROOT", "../image-extraction"))

DISTRICT_PATTERNS = [
    "Inseguros-Barranco-GGZ-2016/**/*.jpg",
    "Inseguros-La_Victoria-GGZ-2016/**/*.jpg",
]

DATA_DIR.mkdir(exist_ok=True)
_lock = threading.Lock()

# ──────────────────────────────────────────────────────────
# I/O
# ──────────────────────────────────────────────────────────

def load_json(path, default):
    p = Path(path)
    if p.exists():
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    return default

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

# ──────────────────────────────────────────────────────────
# IMAGE DISCOVERY
# ──────────────────────────────────────────────────────────

def load_blacklist():
    bl = DATA_DIR / 'blacklist.json'
    if bl.exists():
        with open(bl) as f:
            return set(json.load(f).keys())
    return set()

def discover_images():
    blacklist = load_blacklist()
    images = []
    for pattern in DISTRICT_PATTERNS:
        found = sorted(glob.glob(str(IMAGES_ROOT / pattern), recursive=True))
        rel   = [str(Path(p).relative_to(IMAGES_ROOT)) for p in found]
        images += [r for r in rel if r not in blacklist]
    return images

def build_batches(images, batch_size):
    random.shuffle(images)
    batches = {}
    for i in range(0, len(images), batch_size):
        bid = str(i // batch_size)
        batches[bid] = {"id": int(bid), "images": images[i : i + batch_size]}
    return batches

# ──────────────────────────────────────────────────────────
# INITIALIZATION
# ──────────────────────────────────────────────────────────

def initialize():
    if not BATCHES_FILE.exists():
        print("⏳ Building batch manifest…")
        images = discover_images()
        if not images:
            demo = Path("public/imgs/imgs.json")
            if demo.exists():
                names = json.loads(demo.read_text())
                images = [f"imgs/{n}" for n in names]
                print(f"  ⚠ Using demo images ({len(images)})")
            else:
                images = [f"demo_{i:05d}.jpg" for i in range(200)]
                print("  ⚠ No images — using placeholders")
        batches = build_batches(images, BATCH_SIZE)
        save_json(BATCHES_FILE, batches)
        print(f"  Created {len(batches)} batches of ≤{BATCH_SIZE}")

    if not RESPONSES_FILE.exists():
        save_json(RESPONSES_FILE, {})
    if not ANNOTATORS_FILE.exists():
        save_json(ANNOTATORS_FILE, {})

    batches = load_json(BATCHES_FILE, {})
    mode_str = f"LOCAL  (session='{LOCAL_SESSION_ID}', target=1)" if IS_LOCAL \
               else f"DEPLOYED (target={TARGET_RESPONSES} raters/batch)"
    print(f"✅ Ready — {len(batches)} batches | mode: {mode_str}")

initialize()

# ──────────────────────────────────────────────────────────
# SESSION RESOLUTION
# ──────────────────────────────────────────────────────────

def resolve_session(req_session_id: str, req_alias: str = "") -> tuple[str, str]:
    """
    In LOCAL mode: always return the fixed LOCAL_SESSION_ID, ignoring
    whatever the browser sent.  This means:
      - different browser tabs → same session
      - browser cleared → same session
      - incognito → same session
    In DEPLOYED mode: use the browser-provided session_id as-is.
    """
    if IS_LOCAL:
        return LOCAL_SESSION_ID, LOCAL_SESSION_ALIAS
    return req_session_id, req_alias or req_session_id[:8]

# ──────────────────────────────────────────────────────────
# BATCH PICKING
# ──────────────────────────────────────────────────────────

def pick_batch_for_session(session_id, batches, responses, annotators):
    completed_by_me = set(annotators.get(session_id, {}).get("completed_batches", []))
    in_progress     = annotators.get(session_id, {}).get("in_progress_batch")

    # Resume in-progress first
    if in_progress and str(in_progress) in batches:
        bid = str(in_progress)
        if bid not in completed_by_me:
            return bid

    response_counts = {bid: len(responses.get(bid, {})) for bid in batches}
    eligible = [
        bid for bid in batches
        if bid not in completed_by_me
        and response_counts.get(bid, 0) < TARGET_RESPONSES
    ]
    if not eligible:
        return None

    eligible.sort(key=lambda b: response_counts.get(b, 0))
    min_count  = response_counts.get(eligible[0], 0)
    candidates = [b for b in eligible if response_counts.get(b, 0) == min_count]
    return random.choice(candidates)

# ──────────────────────────────────────────────────────────
# ROUTES
# ──────────────────────────────────────────────────────────

@app.route("/api/status", methods=["GET"])
def status():
    batches   = load_json(BATCHES_FILE, {})
    responses = load_json(RESPONSES_FILE, {})

    total_batches   = len(batches)
    total_images    = sum(len(b["images"]) for b in batches.values())
    saturated       = sum(1 for bid in batches if len(responses.get(bid, {})) >= TARGET_RESPONSES)
    total_responses = sum(len(r) for r in responses.values())
    needed          = total_batches * TARGET_RESPONSES
    progress_pct    = round(total_responses / needed * 100, 1) if needed else 0

    batch_summary = [
        {
            "batch_id":       int(bid),
            "response_count": len(responses.get(bid, {})),
            "target":         TARGET_RESPONSES,
            "saturated":      len(responses.get(bid, {})) >= TARGET_RESPONSES,
            "image_count":    len(b["images"]),
        }
        for bid, b in sorted(batches.items(), key=lambda x: int(x[0]))
    ]

    return jsonify({
        "total_batches":     total_batches,
        "saturated_batches": saturated,
        "open_batches":      total_batches - saturated,
        "total_images":      total_images,
        "total_responses":   total_responses,
        "needed_responses":  needed,
        "progress_pct":      progress_pct,
        "target_responses":  TARGET_RESPONSES,
        "batch_size":        BATCH_SIZE,
        "deploy_mode":       DEPLOY_MODE,
        "batches":           batch_summary,
    })


@app.route("/api/batch/claim", methods=["GET"])
def claim_batch():
    raw_session = request.args.get("session_id", "")
    raw_alias   = request.args.get("alias", "")
    session_id, alias = resolve_session(raw_session, raw_alias)

    # Sociodemographic profile fields
    edad      = request.args.get("edad",      "")
    genero    = request.args.get("genero",    "")
    distrito  = request.args.get("distrito",  "")
    barrio    = request.args.get("barrio",    "")
    educacion = request.args.get("educacion", "")

    with _lock:
        batches    = load_json(BATCHES_FILE, {})
        responses  = load_json(RESPONSES_FILE, {})
        annotators = load_json(ANNOTATORS_FILE, {})

        if session_id not in annotators:
            annotators[session_id] = {
                "alias":             alias,
                "edad":              edad,
                "genero":            genero,
                "distrito":          distrito,
                "barrio":            barrio,
                "educacion":         educacion,
                "first_seen":        time.time(),
                "completed_batches": [],
                "in_progress_batch": None,
                "deploy_mode":       DEPLOY_MODE,
            }
        else:
            # Update profile in case user redoes the form
            if alias:     annotators[session_id]["alias"]     = alias
            if edad:      annotators[session_id]["edad"]      = edad
            if genero:    annotators[session_id]["genero"]    = genero
            if distrito:  annotators[session_id]["distrito"]  = distrito
            if barrio:    annotators[session_id]["barrio"]    = barrio
            if educacion: annotators[session_id]["educacion"] = educacion

        bid = pick_batch_for_session(session_id, batches, responses, annotators)
        if bid is None:
            save_json(ANNOTATORS_FILE, annotators)
            completed = len(annotators[session_id].get("completed_batches", []))
            return jsonify({
                "error":     "no_batches_available",
                "message":   "All batches completed! Nothing left to annotate.",
                "completed": completed,
            }), 404

        annotators[session_id]["in_progress_batch"] = bid
        save_json(ANNOTATORS_FILE, annotators)

        batch         = batches[bid]
        my_completed  = len(annotators[session_id].get("completed_batches", []))

    return jsonify({
        "batch_id":         int(bid),
        "images":           batch["images"],
        "response_count":   len(responses.get(bid, {})),
        "target_responses": TARGET_RESPONSES,
        "session_id":       session_id,   # echoed back so frontend knows real session
        "alias":            alias,
        "my_completed":     my_completed,
        "deploy_mode":      DEPLOY_MODE,
    })


@app.route("/api/batch/<int:batch_id>", methods=["GET"])
def get_batch(batch_id):
    batches   = load_json(BATCHES_FILE, {})
    responses = load_json(RESPONSES_FILE, {})
    bid = str(batch_id)
    if bid not in batches:
        return jsonify({"error": "not_found"}), 404
    b = batches[bid]
    return jsonify({
        "batch_id":       batch_id,
        "images":         b["images"],
        "image_count":    len(b["images"]),
        "response_count": len(responses.get(bid, {})),
        "saturated":      len(responses.get(bid, {})) >= TARGET_RESPONSES,
    })


@app.route("/api/batch/<int:batch_id>/submit", methods=["POST"])
def submit_batch(batch_id):
    data = request.get_json()
    if not data:
        return jsonify({"error": "no_body"}), 400

    raw_session = data.get("session_id", "")
    annotations = data.get("annotations", {})
    session_id, alias = resolve_session(raw_session)
    bid = str(batch_id)

    with _lock:
        batches    = load_json(BATCHES_FILE, {})
        responses  = load_json(RESPONSES_FILE, {})
        annotators = load_json(ANNOTATORS_FILE, {})

        if bid not in batches:
            return jsonify({"error": "batch_not_found"}), 404

        batch_images = batches[bid]["images"]

        # Prevent double-submission
        if session_id in responses.get(bid, {}):
            return jsonify({"error": "already_submitted",
                            "message": "You already submitted this batch."}), 409

        # Validate completeness
        missing = [img for img in batch_images
                   if img not in annotations
                   or annotations[img].get("isDangerous") is None]
        if missing:
            return jsonify({"error": "incomplete", "missing": missing,
                            "message": f"{len(missing)} image(s) not annotated."}), 422

        # Save response
        if bid not in responses:
            responses[bid] = {}
        responses[bid][session_id] = {
            "submitted_at": time.time(),
            "alias":        alias,
            "annotations":  annotations,
        }
        save_json(RESPONSES_FILE, responses)

        # Update annotator record
        if session_id not in annotators:
            annotators[session_id] = {"alias": alias, "completed_batches": [],
                                      "in_progress_batch": None}
        if bid not in annotators[session_id].get("completed_batches", []):
            annotators[session_id].setdefault("completed_batches", []).append(bid)
        annotators[session_id]["in_progress_batch"] = None
        save_json(ANNOTATORS_FILE, annotators)

        response_count = len(responses[bid])
        my_completed   = len(annotators[session_id]["completed_batches"])

    return jsonify({
        "status":         "ok",
        "batch_id":       batch_id,
        "response_count": response_count,
        "saturated":      response_count >= TARGET_RESPONSES,
        "my_completed":   my_completed,
    })


@app.route("/api/responses/export", methods=["GET"])
def export_responses():
    return jsonify(load_json(RESPONSES_FILE, {}))


@app.route("/api/responses/batch/<int:batch_id>", methods=["GET"])
def get_batch_responses(batch_id):
    responses = load_json(RESPONSES_FILE, {})
    bid = str(batch_id)
    batch_resp = responses.get(bid, {})
    return jsonify({"batch_id": batch_id, "response_count": len(batch_resp),
                    "responses": batch_resp})


@app.route("/api/my/status", methods=["GET"])
def my_status():
    raw_session = request.args.get("session_id", "")
    session_id, _ = resolve_session(raw_session)
    annotators = load_json(ANNOTATORS_FILE, {})
    info = annotators.get(session_id, {})
    return jsonify({
        "session_id":        session_id,
        "alias":             info.get("alias", ""),
        "completed_batches": info.get("completed_batches", []),
        "completed_count":   len(info.get("completed_batches", [])),
        "deploy_mode":       DEPLOY_MODE,
    })


@app.route("/api/admin/reset_response", methods=["POST"])
def admin_reset_response():
    data       = request.get_json() or {}
    batch_id   = str(data.get("batch_id"))
    session_id = data.get("session_id")
    with _lock:
        responses  = load_json(RESPONSES_FILE, {})
        annotators = load_json(ANNOTATORS_FILE, {})
        if batch_id in responses and session_id in responses[batch_id]:
            del responses[batch_id][session_id]
            save_json(RESPONSES_FILE, responses)
        if session_id in annotators:
            annotators[session_id]["completed_batches"] = [
                b for b in annotators[session_id].get("completed_batches", [])
                if b != batch_id
            ]
            save_json(ANNOTATORS_FILE, annotators)
    return jsonify({"status": "ok"})


@app.route("/api/admin/rebuild", methods=["POST"])
def admin_rebuild():
    body           = request.get_json() or {}
    new_batch_size = int(body.get("batch_size", BATCH_SIZE))
    with _lock:
        images  = discover_images()
        batches = build_batches(images, new_batch_size)
        save_json(BATCHES_FILE, batches)
        save_json(RESPONSES_FILE, {})
        save_json(ANNOTATORS_FILE, {})
    return jsonify({"status": "ok", "batches": len(batches)})


# ──────────────────────────────────────────────────────────
# IMAGE SERVING
# Vite proxies /imgs/* → Flask → actual files on disk.
# No symlinks, no copying — images stay where they are.
# ──────────────────────────────────────────────────────────

# Resolve IMAGES_ROOT to an absolute path so send_from_directory
# works regardless of the working directory Flask was launched from.
IMAGES_ROOT_ABS = IMAGES_ROOT.resolve()

@app.route("/imgs/<path:img_path>")
def serve_image(img_path):
    """
    Serves images straight from IMAGES_ROOT_ABS.
    img_path is e.g. "Inseguros-Barranco-GGZ-2016/19774833.0/heading_0.jpg"
    """
    return send_from_directory(IMAGES_ROOT_ABS, img_path)


if __name__ == "__main__":
    print(f"\n  Mode: {'LOCAL (solo)' if IS_LOCAL else 'DEPLOYED (multi-rater)'}")
    if IS_LOCAL:
        print(f"  Session pinned to: '{LOCAL_SESSION_ID}' (alias: '{LOCAL_SESSION_ALIAS}')")
        print(f"  To change: set LOCAL_SESSION=yourname before running\n")
    print(f"  Images served from: {IMAGES_ROOT_ABS}")
    if not IMAGES_ROOT_ABS.exists():
        print(f"  ⚠  WARNING: image folder not found at {IMAGES_ROOT_ABS}")
        print(f"     Set IMAGES_ROOT env var or adjust the path in app.py\n")
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port, debug=False)