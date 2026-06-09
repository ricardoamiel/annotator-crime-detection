import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  FiArrowLeft, FiArrowRight, FiRefreshCw, FiCheckCircle, FiLoader,
  FiUsers, FiLayers, FiActivity, FiLock,
} from "react-icons/fi";
import { FaPencilAlt, FaCheck } from "react-icons/fa";
import Anotador from "./Anotador";
import { LIMA_DISTRICTS, BARRIOS_POR_DISTRITO, NIVEL_EDUCATIVO } from "./limaData";

// ─── config ──────────────────────────────────────────────────────────────────
const COLS        = 8;
const ROWS        = 4;
//const API         = "http://127.0.0.1:5000/api";
const API         = import.meta.env.VITE_API_URL || "http://127.0.0.1:5000/api";
const SESSION_KEY  = "ann_session_id";
const ALIAS_KEY    = "ann_alias";
const PROFILE_KEY  = "ann_profile";   // full sociodemographic profile

// Draft keys are PER BATCH so they survive server restarts and page refreshes
// without bleeding into a different batch.
// Format:  ann_draft_<batchId>       → { imgPath: { isDangerous, notes, strokes } }
//          ann_edits_<batchId>       → { imgPath: 0 | 1 | 2 }  (edit count per image)
//          ann_batch_id              → last claimed batch id (to resume on reload)
const DRAFT_KEY   = (bid) => `ann_draft_${bid}`;
const EDITS_KEY   = (bid) => `ann_edits_${bid}`;
const BATCH_ID_KEY = "ann_batch_id";

// Max times an annotator can edit a single image before it locks
const MAX_EDITS = 2;   // 1st save = annotation, 2nd save = edit, then locked

// ─── localStorage helpers ─────────────────────────────────────────────────────

function getSession() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(SESSION_KEY, id); }
  return id;
}

function loadDraft(bid) {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY(bid)) || "{}"); }
  catch { return {}; }
}
function saveDraft(bid, d) {
  try { localStorage.setItem(DRAFT_KEY(bid), JSON.stringify(d)); } catch {}
}
function clearDraft(bid) {
  try {
    localStorage.removeItem(DRAFT_KEY(bid));
    localStorage.removeItem(EDITS_KEY(bid));
    localStorage.removeItem(BATCH_ID_KEY);
  } catch {}
}

function loadEdits(bid) {
  try { return JSON.parse(localStorage.getItem(EDITS_KEY(bid)) || "{}"); }
  catch { return {}; }
}
function saveEdits(bid, e) {
  try { localStorage.setItem(EDITS_KEY(bid), JSON.stringify(e)); } catch {}
}

function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"); }
  catch { return null; }
}
function saveProfile(p) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch {}
}

// ─── component ───────────────────────────────────────────────────────────────

export default function App() {
  const sessionId = useRef(getSession());
  const [alias,      setAlias]     = useState(localStorage.getItem(ALIAS_KEY) || "");
  const [showAlias,  setShowAlias] = useState(!loadProfile());

  // Sociodemographic form state
  const EMPTY_PROFILE = { nickname:"", edad:"", genero:"", distrito:"", barrio:"", educacion:"" };
  const [profile, setProfile] = useState(loadProfile() || EMPTY_PROFILE);
  const [formErrors, setFormErrors] = useState({});

  const [batchId,     setBatchId]     = useState(null);
  const [batchImages, setBatchImages] = useState([]);
  const [batchMeta,   setBatchMeta]   = useState(null);
  const [annotations, setAnnotations] = useState({});
  // editCounts: { imgPath: number } — how many times each image has been saved
  const [editCounts,  setEditCounts]  = useState({});

  const [page,         setPage]        = useState(0);
  const [mode,         setMode]        = useState("grid");
  const [selectedImg,  setSelectedImg] = useState(null);
  const [popupImg,     setPopupImg]    = useState(null);
  const [loadState,    setLoadState]   = useState("idle");
  const [submitState,  setSubmitState] = useState("idle");
  const [submitMsg,    setSubmitMsg]   = useState("");
  const [globalStatus, setGlobalStatus] = useState(null);

  const imagesPerPage = ROWS * COLS;
  const totalPages    = Math.max(1, Math.ceil(batchImages.length / imagesPerPage));

  const annotatedCount = batchImages.filter(
    img => annotations[img]?.isDangerous !== undefined &&
           annotations[img]?.isDangerous !== null
  ).length;
  const batchComplete = batchImages.length > 0 && annotatedCount === batchImages.length;

  // Whether a specific image is locked (reached MAX_EDITS saves)
  const isLocked = (img) => (editCounts[img] ?? 0) >= MAX_EDITS;
  // Whether it's been annotated at least once
  const isAnnotated = (img) => annotations[img]?.isDangerous !== undefined &&
                                annotations[img]?.isDangerous !== null;

  // ── persist draft + edits to localStorage on every change ─────────────────
  useEffect(() => {
    if (batchId === null) return;
    saveDraft(batchId, annotations);
  }, [annotations, batchId]);

  useEffect(() => {
    if (batchId === null) return;
    saveEdits(batchId, editCounts);
  }, [editCounts, batchId]);

  // ── escape closes popup ────────────────────────────────────────────────────
  useEffect(() => {
    const h = e => { if (e.key === "Escape" && popupImg) setPopupImg(null); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [popupImg]);

  // ── fetch global status ───────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API}/status`);
      setGlobalStatus(await r.json());
    } catch {}
  }, []);

  // ── claim batch ───────────────────────────────────────────────────────────
  const claimBatch = useCallback(async () => {
    setLoadState("loading");
    setSubmitMsg("");
    try {
      const sid    = sessionId.current;
      const p = loadProfile() || {};
      const params = new URLSearchParams({
        session_id: sid,
        alias:      p.nickname || localStorage.getItem(ALIAS_KEY) || "",
        edad:       p.edad       || "",
        genero:     p.genero     || "",
        distrito:   p.distrito   || "",
        barrio:     p.barrio     || "",
        educacion:  p.educacion  || "",
      });
      const res  = await fetch(`${API}/batch/claim?${params}`);
      const data = await res.json();

      if (!res.ok) {
        setLoadState("none_left");
        setSubmitMsg(data.message || "");
        return;
      }

      // LOCAL mode: server overrides identity
      if (data.session_id && data.session_id !== sessionId.current) {
        sessionId.current = data.session_id;
      }
      if (data.deploy_mode === "local") {
        const serverAlias = data.alias || "Local Annotator";
        localStorage.setItem(ALIAS_KEY, serverAlias);
        setAlias(serverAlias);
        setShowAlias(false);
      }

      const bid = data.batch_id;

      // Persist the batch id so we can resume after refresh/server restart
      localStorage.setItem(BATCH_ID_KEY, String(bid));

      // Restore draft + edit counts for THIS batch from localStorage
      const draft = loadDraft(bid);
      const edits = loadEdits(bid);

      setBatchId(bid);
      setBatchImages(data.images);
      setBatchMeta({
        response_count:   data.response_count,
        target_responses: data.target_responses,
        my_completed:     data.my_completed,
        deploy_mode:      data.deploy_mode,
      });
      setPage(0);
      setAnnotations(draft);
      setEditCounts(edits);
      setLoadState("ready");
      fetchStatus();
    } catch (err) {
      console.error(err);
      setLoadState("error");
    }
  }, [fetchStatus]);

  // ── on mount ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!showAlias) claimBatch();
    fetchStatus();
  }, [showAlias, claimBatch, fetchStatus]);

  // ── submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!batchComplete || submitState === "submitting") return;
    setSubmitState("submitting");
    try {
      const res  = await fetch(`${API}/batch/${batchId}/submit`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ session_id: sessionId.current, annotations }),
      });
      const data = await res.json();
      if (res.ok) {
        setSubmitState("ok");
        setSubmitMsg(`✅ Lote ${batchId} enviado (${data.my_completed} lotes completados). Cargando siguiente…`);
        clearDraft(batchId);
        setAnnotations({});
        setEditCounts({});
        setBatchImages([]);
        setTimeout(() => {
          setSubmitState("idle");
          setSubmitMsg("");
          claimBatch();
        }, 2000);
      } else {
        setSubmitState("error");
        setSubmitMsg(data.message || `Error ${res.status}`);
      }
    } catch (err) {
      setSubmitState("error");
      setSubmitMsg(`Error de red: ${err.message}`);
    }
  };

  // ── profile form ─────────────────────────────────────────────────────────
  function setField(k, v) {
    setProfile(prev => {
      const next = { ...prev, [k]: v };
      if (k === "distrito") next.barrio = "";   // reset barrio when district changes
      return next;
    });
    setFormErrors(prev => ({ ...prev, [k]: false }));
  }

  function confirmProfile() {
    const errors = {};
    if (!profile.nickname.trim()) errors.nickname  = true;
    if (!profile.edad || isNaN(Number(profile.edad)) || Number(profile.edad) < 10 || Number(profile.edad) > 100)
      errors.edad = true;
    if (!profile.distrito)   errors.distrito   = true;
    if (!profile.barrio)     errors.barrio     = true;
    if (!profile.genero)     errors.genero     = true;
  if (!profile.educacion)  errors.educacion  = true;
    if (Object.keys(errors).length) { setFormErrors(errors); return; }

    const name = profile.nickname.trim();
    localStorage.setItem(ALIAS_KEY, name);
    saveProfile({ ...profile, nickname: name });
    setAlias(name);
    setShowAlias(false);
  }

  if (showAlias) {
    const barrios = profile.distrito ? (BARRIOS_POR_DISTRITO[profile.distrito] || []) : [];
    const err = (k) => formErrors[k] ? { border: "1.5px solid #ef4444" } : {};

    return (
      <div style={s.center}>
        <div style={s.profileBox}>
          <div style={s.profileHeader}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Información del participante</h2>
            <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 13 }}>
              Esta información es confidencial y solo se usa con fines de investigación.
            </p>
          </div>

          <div style={s.formGrid}>

            {/* Nickname */}
            <label style={s.label}>
              Nickname *
              <input
                autoFocus
                placeholder="Ej: Ricardo"
                value={profile.nickname}
                onChange={e => setField("nickname", e.target.value)}
                style={{ ...s.input, ...err("nickname") }}
              />
              {formErrors.nickname && <span style={s.errMsg}>Ingresa un nickname</span>}
            </label>

            {/* Edad */}
            <label style={s.label}>
              Edad *
              <input
                type="number" min="10" max="100"
                placeholder="Ej: 21"
                value={profile.edad}
                onChange={e => setField("edad", e.target.value)}
                style={{ ...s.input, ...err("edad") }}
              />
              {formErrors.edad && <span style={s.errMsg}>Ingresa una edad válida (10–100)</span>}
            </label>

            {/* Género */}
            <label style={s.label}>
              Género *
              <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
                {[{v:"masculino", l:"Masculino"}, {v:"femenino", l:"Femenino"}].map(opt => {
                  const sel = profile.genero === opt.v;
                  return (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setField("genero", opt.v)}
                      style={{
                        flex: 1, padding: "9px 0", borderRadius: 8,
                        fontSize: 14, fontWeight: 500, cursor: "pointer",
                        transition: "all .15s",
                        background: sel ? "#1d4ed8" : "#f3f4f6",
                        color:      sel ? "#fff"    : "#374151",
                        border:     sel ? "2px solid #1d4ed8"
                                       : formErrors.genero
                                         ? "2px solid #ef4444"
                                         : "2px solid transparent",
                      }}
                    >
                      {opt.l}
                    </button>
                  );
                })}
              </div>
              {formErrors.genero && <span style={s.errMsg}>Selecciona tu género</span>}
            </label>

            {/* Distrito */}
            <label style={s.label}>
              Distrito de vivienda actual *
              <select
                value={profile.distrito}
                onChange={e => setField("distrito", e.target.value)}
                style={{ ...s.input, ...err("distrito") }}
              >
                <option value="">— Selecciona un distrito —</option>
                {LIMA_DISTRICTS.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              {formErrors.distrito && <span style={s.errMsg}>Selecciona tu distrito</span>}
            </label>

            {/* Barrio */}
            <label style={s.label}>
              Barrio / Urbanización / Avenida *
              <select
                value={profile.barrio}
                onChange={e => setField("barrio", e.target.value)}
                disabled={!profile.distrito}
                style={{ ...s.input, ...err("barrio"),
                  background: !profile.distrito ? "#f9fafb" : undefined,
                  color:      !profile.distrito ? "#9ca3af" : undefined,
                }}
              >
                <option value="">
                  {profile.distrito ? "— Selecciona un barrio —" : "Selecciona primero el distrito"}
                </option>
                {barrios.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              {formErrors.barrio && <span style={s.errMsg}>Selecciona tu barrio</span>}
            </label>

            {/* Nivel educativo — full width */}
            <label style={{ ...s.label, gridColumn: "1 / -1" }}>
              Nivel educativo *
              <div style={s.eduGrid}>
                {NIVEL_EDUCATIVO.map(opt => {
                  const selected = profile.educacion === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setField("educacion", opt.value)}
                      style={{
                        ...s.eduBtn,
                        background: selected ? "#1d4ed8" : "#f3f4f6",
                        color:      selected ? "#fff"    : "#374151",
                        border:     selected ? "2px solid #1d4ed8"
                                             : formErrors.educacion
                                               ? "2px solid #ef4444"
                                               : "2px solid transparent",
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {formErrors.educacion && <span style={s.errMsg}>Selecciona tu nivel educativo</span>}
            </label>

          </div>

          <button style={s.startBtn} onClick={confirmProfile}>
            Comenzar a anotar →
          </button>
        </div>
      </div>
    );
  }

  // ── loading / error screens ───────────────────────────────────────────────
  if (loadState === "loading") return (
    <div style={s.center}>
      <FiLoader size={32} style={{ animation: "spin 1s linear infinite" }} />
      <p style={{ color: "#6b7280", marginTop: 12 }}>Solicitando lote…</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (loadState === "error") return (
    <div style={s.center}>
      <p style={{ color: "#ef4444", marginBottom: 12 }}>
        No se pudo conectar con el servidor.<br />
        Asegúrate de que Flask corra en localhost:5000.
      </p>
      <button style={s.startBtn} onClick={claimBatch}>Reintentar</button>
    </div>
  );

  if (loadState === "none_left") return (
    <div style={s.center}>
      <FiCheckCircle size={52} color="#22c55e" />
      <h2 style={{ marginTop: 12 }}>¡Gracias, {alias}!</h2>
      <p style={{ color: "#6b7280", textAlign: "center", maxWidth: 360 }}>
        {submitMsg || "No quedan lotes disponibles por ahora."}
      </p>
      {globalStatus && (
        <p style={{ color: "#6b7280", fontSize: 13 }}>
          Progreso global: <strong>{globalStatus.progress_pct}%</strong>
        </p>
      )}
      <button style={{ ...s.startBtn, marginTop: 16 }} onClick={claimBatch}>
        Buscar más lotes
      </button>
    </div>
  );

  // ── annotator mode ────────────────────────────────────────────────────────
  if (mode === "annotator" && selectedImg) {
    const locked = isLocked(selectedImg);
    return (
      <Anotador
        key={selectedImg}
        image={`/imgs/${selectedImg}`}
        initialData={annotations[selectedImg]}
        locked={locked}
        editCount={editCounts[selectedImg] ?? 0}
        maxEdits={MAX_EDITS}
        onSave={data => {
          if (locked) return;   // safety guard — Anotador also blocks this
          const saved = {
            isDangerous: data.isDangerous,
            notes:       data.notes   || "",
            strokes:     data.strokes || [],
          };
          setAnnotations(prev => ({ ...prev, [selectedImg]: saved }));
          setEditCounts(prev => ({
            ...prev,
            [selectedImg]: (prev[selectedImg] ?? 0) + 1,
          }));

          // Auto-advance to next unlocked unannotated image on this page
          const startIdx = page * imagesPerPage;
          const pageImgs = batchImages.slice(startIdx, startIdx + imagesPerPage);
          const updatedAnnotations = { ...annotations, [selectedImg]: saved };
          const next = pageImgs.find(
            img => img !== selectedImg && (
              updatedAnnotations[img]?.isDangerous === undefined ||
              updatedAnnotations[img]?.isDangerous === null
            )
          );
          setSelectedImg(next || null);
          if (!next) setMode("grid");
        }}
        onCancel={() => { setMode("grid"); setSelectedImg(null); }}
      />
    );
  }

  // ── grid ──────────────────────────────────────────────────────────────────
  const startIdx   = page * imagesPerPage;
  const pageImages = batchImages.slice(startIdx, startIdx + imagesPerPage);

  return (
    <div style={s.root}>

      {/* Header */}
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <h1 style={s.title}>Anotador</h1>
          <span style={s.userTag}>👤 {alias}</span>
        </div>
        {globalStatus && (
          <div style={s.statRow}>
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: "0.05em",
              padding: "2px 9px", borderRadius: 99,
              background: globalStatus.deploy_mode === "local" ? "#fef3c7" : "#dbeafe",
              color:      globalStatus.deploy_mode === "local" ? "#92400e" : "#1e40af",
            }}>
              {globalStatus.deploy_mode === "local" ? "💻 LOCAL" : "🌐 DEPLOYED"}
            </span>
            <Stat icon={<FiActivity size={13}/>}
              label={`${globalStatus.progress_pct}% completado`}
              sub={`${globalStatus.total_responses.toLocaleString()} / ${globalStatus.needed_responses.toLocaleString()} respuestas`} />
            <Stat icon={<FiLayers size={13}/>}
              label={`${globalStatus.saturated_batches} / ${globalStatus.total_batches} lotes listos`}
              sub={`objetivo: ${globalStatus.target_responses} rater${globalStatus.target_responses > 1 ? "s" : ""}/lote`} />
            <Stat icon={<FiUsers size={13}/>}
              label={`${batchMeta?.my_completed ?? "?"} lotes completados por ti`} />
            <button onClick={fetchStatus} style={s.iconBtn} title="Actualizar">
              <FiRefreshCw size={13} />
            </button>
          </div>
        )}
      </div>

      {/* Batch bar */}
      <div style={s.batchBar}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={s.batchLabel}>Lote #{batchId}</span>
          {batchMeta && (
            <span style={s.raterPill}>
              {batchMeta.response_count} / {batchMeta.target_responses} raters
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
          <div style={s.track}>
            <div style={{ ...s.fill, width: `${(annotatedCount / batchImages.length) * 100}%` }} />
          </div>
          <span style={s.countLabel}>{annotatedCount} / {batchImages.length}</span>
        </div>
      </div>

      {/* Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${COLS}, 138px)`,
        gap: "10px",
        justifyContent: "center",
        marginBottom: 16,
      }}>
        {pageImages.map((img, idx) => {
          const ann      = annotations[img];
          const annotated = ann?.isDangerous !== undefined && ann?.isDangerous !== null;
          const locked   = isLocked(img);
          const edits    = editCounts[img] ?? 0;
          const selected = selectedImg === img;

          // Ring color
          let ring = "0 0 0 2px #d1d5db";
          if (annotated && ann.isDangerous)  ring = "0 0 0 3px #ef4444, 0 2px 8px rgba(239,68,68,.3)";
          if (annotated && !ann.isDangerous) ring = "0 0 0 3px #22c55e, 0 2px 8px rgba(34,197,94,.3)";
          if (selected)                      ring = "0 0 0 3px #f59e0b, 0 2px 8px rgba(245,158,11,.4)";

          // Clickable only if not locked, or locked (show lock icon, don't open annotator)
          const handleClick = () => {
            setSelectedImg(img);
            setPopupImg(img);
          };

          return (
            <div key={idx} style={{ ...s.thumb, boxShadow: ring }} onClick={handleClick}>
              <img src={`/imgs/${img}`} alt="" style={s.thumbImg} />

              {/* Status badge */}
              {annotated && !locked && (
                <div style={{ ...s.badge, background: ann.isDangerous ? "#ef4444" : "#22c55e" }}>
                  {ann.isDangerous ? "⚠" : <FaCheck size={9}/>}
                </div>
              )}

              {/* Lock badge — shown when image is fully locked */}
              {locked && (
                <div style={{ ...s.badge, background: "#6b7280" }}>
                  <FiLock size={9} />
                </div>
              )}

              {/* Edit counter — shown when annotated but not yet locked */}
              {annotated && !locked && edits > 0 && (
                <div style={s.editPill}>
                  {edits === 1
                    ? `1 edición restante`
                    : `${MAX_EDITS - edits} ed. restantes`}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Controls */}
      <div style={s.ctrlRow}>
        <button onClick={() => setPage(p => Math.max(0, p - 1))}
          disabled={page === 0} style={s.iconBtn}>
          <FiArrowLeft size={16} />
        </button>

        <button
          onClick={() => {
            if (!selectedImg) return;
            if (isLocked(selectedImg)) return;
            setPopupImg(null);
            setMode("annotator");
          }}
          disabled={!selectedImg || isLocked(selectedImg)}
          style={{
            ...s.iconBtn,
            background: (!selectedImg || isLocked(selectedImg)) ? "#e5e7eb" : "#1d4ed8",
            color:      (!selectedImg || isLocked(selectedImg)) ? "#9ca3af" : "#fff",
          }}
          title={
            !selectedImg         ? "Selecciona una imagen" :
            isLocked(selectedImg) ? "Imagen bloqueada — no se puede editar más" :
            isAnnotated(selectedImg) ? "Editar anotación (1 edición restante)" :
            "Anotar imagen"
          }
        >
          {selectedImg && isLocked(selectedImg)
            ? <FiLock size={15} />
            : <FaPencilAlt size={15} />}
        </button>

        <button
          onClick={handleSubmit}
          disabled={!batchComplete || submitState === "submitting"}
          style={{
            ...s.submitBtn,
            background: batchComplete ? "#16a34a" : "#9ca3af",
            cursor:     batchComplete ? "pointer"  : "not-allowed",
          }}
        >
          {submitState === "submitting" ? "Enviando…"
            : batchComplete ? "✔ Enviar lote"
            : `Faltan ${batchImages.length - annotatedCount}`}
        </button>

        <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
          disabled={page >= totalPages - 1} style={s.iconBtn}>
          <FiArrowRight size={16} />
        </button>
      </div>

      {/* Pagination */}
      <div style={s.pageRow}>
        <span>Página {page + 1} / {totalPages}</span>
        <input type="number" min={1} max={totalPages} placeholder="Ir a"
          style={s.pageInput}
          onKeyDown={e => {
            if (e.key === "Enter") {
              setPage(Math.min(Math.max(Number(e.target.value) - 1, 0), totalPages - 1));
              e.target.value = "";
            }
          }} />
      </div>

      {submitMsg && (
        <p style={{ color: submitState === "error" ? "#ef4444" : "#16a34a",
                    fontWeight: 500, marginTop: 8, fontSize: 14 }}>
          {submitMsg}
        </p>
      )}

      {/* Popup */}
      {popupImg && (
        <div onClick={e => { if (e.target === e.currentTarget) setPopupImg(null); }}
          style={s.overlay}>
          <div style={{ position: "relative" }}>
            <img src={`/imgs/${popupImg}`} alt=""
              style={{ maxWidth: "85vw", maxHeight: "80vh", borderRadius: 12 }} />

            {isLocked(popupImg) ? (
              /* Locked — show info, no annotate button */
              <div style={{
                position: "absolute", bottom: 12, right: 12,
                background: "rgba(0,0,0,0.7)", color: "#fff",
                padding: "8px 14px", borderRadius: 8, fontSize: 13,
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <FiLock size={14} /> Bloqueada — no editable
              </div>
            ) : (
              <button
                onClick={() => { setPopupImg(null); setMode("annotator"); }}
                style={{ ...s.submitBtn, position: "absolute", bottom: 12, right: 12,
                         background: isAnnotated(popupImg) ? "#d97706" : "#1d4ed8" }}
              >
                <FaPencilAlt style={{ marginRight: 6 }} />
                {isAnnotated(popupImg) ? "Editar" : "Anotar"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stat widget ──────────────────────────────────────────────────────────────
function Stat({ icon, label, sub }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5,
                  color: "#6b7280", fontSize: 12 }}>
      {icon}
      <span>
        <strong style={{ color: "#111" }}>{label}</strong>
        {sub ? ` — ${sub}` : ""}
      </span>
    </div>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────
const s = {
  root: {
    width: "100vw", minHeight: "100vh",
    display: "flex", flexDirection: "column", alignItems: "center",
    background: "#f3f4f6", padding: "18px 16px 48px",
  },
  center: {
    width: "100vw", minHeight: "100vh",
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    gap: 12, padding: 32,
  },
  header: {
    width: "100%", maxWidth: 1200, marginBottom: 12,
    display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
  },
  title:    { margin: 0, fontSize: 26, fontWeight: 700 },
  userTag:  { fontSize: 13, color: "#6b7280", background: "#e5e7eb",
              padding: "2px 8px", borderRadius: 99 },
  statRow:  { display: "flex", flexWrap: "wrap", gap: 16,
              alignItems: "center", justifyContent: "center" },
  batchBar: {
    width: "100%", maxWidth: 1200,
    display: "flex", alignItems: "center", gap: 14,
    marginBottom: 14, flexWrap: "wrap",
  },
  batchLabel: { fontWeight: 700, fontSize: 14 },
  raterPill:  { fontSize: 12, background: "#dbeafe", color: "#1d4ed8",
                borderRadius: 99, padding: "2px 9px", fontWeight: 600 },
  track: { flex: 1, height: 7, background: "#e5e7eb", borderRadius: 99,
           overflow: "hidden", minWidth: 120 },
  fill:  { height: "100%", background: "linear-gradient(90deg,#16a34a,#4ade80)",
           borderRadius: 99, transition: "width .3s" },
  countLabel: { fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" },
  thumb: {
    width: 138, height: 138, borderRadius: 9, overflow: "hidden",
    cursor: "pointer", position: "relative",
    transition: "box-shadow .18s",
  },
  thumbImg: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  badge: {
    position: "absolute", top: 5, right: 5,
    width: 20, height: 20, borderRadius: "50%",
    color: "#fff", fontSize: 11, fontWeight: 700,
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 1px 4px rgba(0,0,0,.3)",
  },
  editPill: {
    position: "absolute", bottom: 5, left: 5, right: 5,
    background: "rgba(0,0,0,0.55)", color: "#fff",
    fontSize: 10, borderRadius: 4, padding: "2px 5px",
    textAlign: "center",
  },
  ctrlRow: {
    display: "flex", gap: 10, alignItems: "center",
    flexWrap: "wrap", justifyContent: "center", marginBottom: 8,
  },
  iconBtn: {
    padding: "9px 13px", borderRadius: 8, border: "1px solid #d1d5db",
    background: "#1f2937", color: "#fff", cursor: "pointer",
    display: "flex", alignItems: "center",
  },
  submitBtn: {
    padding: "9px 18px", borderRadius: 8, border: "none",
    color: "#fff", fontWeight: 600, fontSize: 14,
    display: "flex", alignItems: "center", gap: 6,
    transition: "background .2s",
  },
  pageRow:   { display: "flex", alignItems: "center", gap: 10,
               fontSize: 13, color: "#6b7280" },
  pageInput: { width: 58, textAlign: "center", background: "#e9ecef",
               border: "1px solid #ccc", borderRadius: 6,
               padding: "3px 5px", color: "#111" },
  overlay:   { position: "fixed", inset: 0, background: "rgba(0,0,0,.75)",
               display: "flex", alignItems: "center", justifyContent: "center",
               zIndex: 2000 },
  aliasBox:  { background: "#fff", borderRadius: 16, padding: "32px 28px",
               boxShadow: "0 4px 24px rgba(0,0,0,.12)", width: "100%", maxWidth: 380,
               display: "flex", flexDirection: "column", alignItems: "center", gap: 12 },
  aliasInput: { width: "100%", padding: "10px 14px", borderRadius: 8,
                border: "1px solid #d1d5db", fontSize: 15, boxSizing: "border-box" },
  startBtn:  { padding: "11px 22px", borderRadius: 8, border: "none",
               background: "#1d4ed8", color: "#fff", fontWeight: 600,
               fontSize: 14, cursor: "pointer", width: "100%" },
  // Profile form
  profileBox: {
    background: "#fff", borderRadius: 18, width: "100%", maxWidth: 620,
    boxShadow: "0 6px 32px rgba(0,0,0,.13)",
    display: "flex", flexDirection: "column", gap: 0, overflow: "hidden",
  },
  profileHeader: {
    background: "linear-gradient(135deg,#1d4ed8,#3b82f6)",
    padding: "24px 28px", color: "#fff",
  },
  formGrid: {
    display: "grid", gridTemplateColumns: "1fr 1fr",
    gap: "16px 20px", padding: "24px 28px",
  },
  label: {
    display: "flex", flexDirection: "column", gap: 5,
    fontSize: 13, fontWeight: 600, color: "#374151",
  },
  input: {
    padding: "10px 12px", borderRadius: 8, fontSize: 14,
    border: "1.5px solid #e5e7eb", outline: "none",
    background: "#fff", color: "#111", width: "100%", boxSizing: "border-box",
  },
  errMsg: { fontSize: 11, color: "#ef4444", marginTop: 2 },
  eduGrid: {
    display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4,
  },
  eduBtn: {
    padding: "7px 14px", borderRadius: 8, fontSize: 13,
    fontWeight: 500, cursor: "pointer", transition: "all .15s",
  },
};