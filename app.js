// TB Betong v0.2.1 – Trimble Connect 3D-viewer extension (Total Betong, 1277 Jåtunparken)
// To visninger fra samme kode:  index.html?view=pk  og  index.html?view=konstruksjon
// All behandling skjer i nettleseren. Ingen data sendes ut av Trimble Connect.

// pk.html / konstruksjon.html (egne sider, så Trimble ser to ulike extensions). ?view= virker fortsatt.
const VIEW = (/konstruksjon/i.test(location.pathname) || new URLSearchParams(location.search).get("view") === "konstruksjon")
  ? "konstruksjon" : "pk";
const PROJECT_FILE = "1277_Jåtunparken";

// RefCompClass -> navn (rekkefølge = visningsrekkefølge)
const TYPES = [
  ["AHE", "Punktfundamenter"],
  ["AHF", "Sålefundamenter"],
  ["ASA", "Søyler"],
  ["AVA", "Yttervegger"],
  ["AVB", "Innervegger"],
  ["ABA", "Bjelker"],
  ["ADA", "Dekker"],
  ["AOA", "Gulv"],
];
const TYPE_NAME = new Map(TYPES);
const TYPE_ORDER = new Map(TYPES.map(([c], i) => [c, i]));

// Egenskapsnavn (sammenlignes uten mellomrom/understrek/punktum, små bokstaver)
const P = {
  ref: ["RefCompClass"],
  pk: ["Pk koder", "PK koder", "PK"],
  del: ["Byggningsdel", "Bygningsdel"],
  date: ["Støpe Dato", "Støpedato"],
  vol: ["Volume", "volum", "Volum"],
  gross: ["GrossArea"],
  area: ["areal", "Areal", "Area"],
  mat: ["Material", "Materiale"],
  type: ["type", "Type"],
  name: ["Name", "Product Name"],
};

// Støy -> "Annet" (avklart med Krister 2026-11-10)
const NOISE_TYPE = /prefab|steinull|\beps\b|\bxps\b|isolasjon/i;
const STEEL = /^\s*S\d{3}|stål|steel|metal/i;                 // materiale
// Stålprofiler i type/navn (HUP, KFHUP, VKR, RHS, HEA/HEB, IPE, UNP …)
const STEEL_PROFILE = /\b(K?F?C?HUP|VKR|KKR|RHS|SHS|CHS|HE\s?\d*[ABM]|HE[ABM]|IPE|UNP|UPE|INP|HSQ|L\s?\d+\s?x\s?\d+)/i;
const SKIP_CLASS = /^Ifc(Project|Site|Building|BuildingStorey|Space|OpeningElement|Grid|Annotation|Zone)$/i;

const COLORS = {
  stopt: { r: 46, g: 160, b: 67, a: 255 },      // grønn
  planlagt: { r: 218, g: 33, b: 44, a: 255 },   // rød
  gjenstar: { r: 0, g: 99, b: 163, a: 255 },    // blå
};
const STATUS_NAME = { stopt: "Støpt", planlagt: "Planlagt", gjenstar: "Gjenstår" };
const LABEL_DEFAULT = { r: 60, g: 60, b: 60, a: 255 };
const LABEL_MAX = 150;
const BATCH = 500;

const el = (id) => document.getElementById(id);
const ui = {
  logo: el("logo"), title: el("title"), treeTitle: el("treeTitle"),
  infoBtn: el("infoBtn"), infoBox: el("infoBox"),
  selSum: el("selSum"), csvSel: el("csvSel"),
  stampLabels: el("stampLabels"), clearLabels: el("clearLabels"), labelInfo: el("labelInfo"), labelOffset: el("labelOffset"),
  colorAll: el("colorAll"), resetColors: el("resetColors"), groups: el("groups"),
  rescan: el("rescan"), floorThick: el("floorThick"), status: el("status"),
};

let api = null;
let items = [];
let itemIndex = new Map();   // "modelId|id" -> item
let allObjects = [];         // [{ modelId, ids }]
let scanning = false;
let appliedColors = new Map();
let labelIds = [], labelTexts = new Set(), labelBusy = false;
let selTimer = null, currentSel = [];

// ---------- hjelpere ----------
const norm = (v) => String(v ?? "").trim().toLowerCase();
const normName = (v) => norm(v).replace(/[\s_.\-]/g, "");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const natural = (a, b) => String(a).localeCompare(String(b), "no", { numeric: true });
const nf1 = new Intl.NumberFormat("no-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("no-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const key = (o) => o.modelId + "|" + o.id;

function setStatus(text, isError = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle("error", isError);
}
async function safe(fn, msg) {
  try { await fn(); } catch (err) { console.error(err); setStatus(msg + ": " + (err?.message || err), true); }
}
function pick(flat, names) {
  for (const n of names) {
    const v = flat.get(normName(n));
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s !== "" && s !== "--") return v;
  }
  return null;
}
function num(v) {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function parseDate(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") v = Number(v);
  if (typeof v === "number" || /^\d{9,}$/.test(String(v))) {
    let n = Number(v);
    if (n < 1e11) n *= 1000; // sekunder -> ms
    const d = new Date(n);
    return isNaN(d) ? null : d;
  }
  const s = String(v).trim();
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}
function statusOf(d) {
  if (!d) return "gjenstar";
  const end = new Date(); end.setHours(23, 59, 59, 999);
  return d <= end ? "stopt" : "planlagt";
}
function fmtDate(d) {
  return d ? `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}` : "";
}
function toSelector(objs) {
  const byModel = new Map();
  for (const o of objs) {
    if (!byModel.has(o.modelId)) byModel.set(o.modelId, []);
    byModel.get(o.modelId).push(o.id);
  }
  return { modelObjectIds: [...byModel].map(([modelId, ids]) => ({ modelId, objectRuntimeIds: ids })) };
}

// ---------- skanning ----------
async function scan() {
  if (scanning) return;
  scanning = true;
  [ui.rescan, ui.colorAll, ui.resetColors, ui.stampLabels, ui.clearLabels].forEach((b) => (b.disabled = true));
  const thick = Math.max(0.01, num(ui.floorThick.value) || 0.12);

  try {
    setStatus("Henter objekter fra modellene …");
    const modelObjects = await api.viewer.getObjects();
    allObjects = (modelObjects || []).map((mo) => ({ modelId: mo.modelId, ids: (mo.objects || []).map((o) => o.id) }));
    const found = [];
    let total = 0;

    for (const mo of modelObjects || []) {
      const ids = (mo.objects || []).map((o) => o.id);
      total += ids.length;
      for (let i = 0; i < ids.length; i += BATCH) {
        setStatus(`Leser egenskaper … ${Math.min(i + BATCH, ids.length)} / ${ids.length} objekter`);
        const props = await api.viewer.getObjectProperties(mo.modelId, ids.slice(i, i + BATCH));
        for (const op of props || []) {
          const cls = op.class || "";
          if (SKIP_CLASS.test(cls)) continue;
          const flat = new Map();
          for (const pset of op.properties || []) {
            for (const p of pset.properties || []) {
              const k = normName(p.name);
              if (!flat.has(k)) flat.set(k, p.value);
            }
          }
          let ref = pick(flat, P.ref);
          ref = ref ? String(ref).trim().toUpperCase() : null;
          if (ref === ".") ref = null;
          const pk = pick(flat, P.pk);
          const volRaw = num(pick(flat, P.vol));
          const gross = num(pick(flat, P.gross));
          const areal = num(pick(flat, P.area));
          // Bare elementer med klassifisering, PK eller volum tas med
          if (!ref && !pk && volRaw === null) continue;

          const type = String(pick(flat, P.type) ?? "").trim();
          const name = String((op.product && op.product.name) || pick(flat, P.name) || "").trim();
          const mat = String(pick(flat, P.mat) ?? "").trim();
          const del = String(pick(flat, P.del) ?? "").trim();
          const dateRaw = pick(flat, P.date);
          const date = parseDate(dateRaw);

          // Stål -> egen gruppe "Stål"; øvrig støy -> "Annet"
          let annet = null, steel = null;
          if (!ref) annet = "Mangler RefCompClass";
          else if (/BuildingElementProxy/i.test(cls)) steel = "Stålplater";
          else if (STEEL.test(mat) || STEEL_PROFILE.test(type) || STEEL_PROFILE.test(name)) {
            steel = ref === "ASA" ? "Stålsøyler" : ref === "ABA" ? "Stålbjelker" : "Annet stål";
          }
          else if (NOISE_TYPE.test(type) || NOISE_TYPE.test(name)) annet = "Prefab og isolasjon";

          // Mengder
          let vol = volRaw, area = areal ?? gross;
          if (ref === "AOA") {                       // gulv: GrossArea × tykkelse
            area = gross ?? areal;
            vol = gross !== null ? gross * thick : volRaw;
          }

          found.push({
            modelId: mo.modelId, id: op.id,
            ref, refName: TYPE_NAME.get(ref) || (ref ? `Ukjent (${ref})` : "–"),
            pk: pk ? String(pk).trim() : null,
            del, endring: /endringsarbeid/i.test(del),
            type: type || name.replace(/:\d+$/, "") || "(uten type)",
            name, mat,
            date, status: statusOf(date),
            vol: vol ?? 0, area: area ?? 0,
            annet, steel,
            dateRaw: dateRaw === null ? "" : String(dateRaw),
          });
        }
      }
    }

    items = found;
    itemIndex = new Map(items.map((o) => [key(o), o]));
    renderTree();
    const noise = items.filter((o) => o.annet).length;
    const steelN = items.filter((o) => o.steel).length;
    setStatus(`Klar. ${items.length - noise - steelN} betongelementer, ${steelN} stål, ${noise} i «Annet» (av ${total} objekter).`);
    [ui.colorAll, ui.resetColors, ui.stampLabels, ui.clearLabels].forEach((b) => (b.disabled = false));
    updateSelection();
  } catch (err) {
    console.error(err);
    setStatus("Feil ved skanning: " + (err?.message || err), true);
  } finally {
    scanning = false;
    ui.rescan.disabled = false;
  }
}

// ---------- mengder ----------
function stats(objs) {
  const s = { n: objs.length, vol: 0, area: 0, stopt: 0, planlagt: 0, gjenstar: 0, eVol: 0, eN: 0 };
  for (const o of objs) {
    s.vol += o.vol; s.area += o.area; s[o.status] += o.vol;
    if (o.endring) { s.eVol += o.vol; s.eN++; }
  }
  return s;
}
function statsHtml(s) {
  const pct = (v) => (s.vol > 0 ? (v / s.vol) * 100 : 0);
  const e = s.eN ? `<br><b class="badge">E</b> herav endringsarbeider: <b>${nf1.format(s.eVol)} m³</b> (${s.eN} stk)` : "";
  return `<b>${nf1.format(s.vol)} m³</b> · ${nf1.format(s.area)} m² · ${s.n} stk<br>` +
    `<span class="st"><i class="sw" style="background:#2ea043"></i>${nf1.format(s.stopt)}</span>` +
    `<span class="st"><i class="sw" style="background:#da212c"></i>${nf1.format(s.planlagt)}</span>` +
    `<span class="st"><i class="sw" style="background:#0063a3"></i>${nf1.format(s.gjenstar)} m³</span>` +
    `<div class="bar"><i style="width:${pct(s.stopt)}%;background:#2ea043"></i><i style="width:${pct(s.planlagt)}%;background:#da212c"></i><i style="width:${pct(s.gjenstar)}%;background:#0063a3"></i></div>` + e;
}

// ---------- tre ----------
function groupBy(objs, fn) {
  const m = new Map();
  for (const o of objs) { const k = fn(o); if (!m.has(k)) m.set(k, []); m.get(k).push(o); }
  return m;
}
const byRefOrder = (a, b) => (TYPE_ORDER.get(a.ref) ?? 99) - (TYPE_ORDER.get(b.ref) ?? 99) || natural(a.title, b.title);

function buildTreeData() {
  const concrete = items.filter((o) => !o.annet && !o.steel);
  const noise = items.filter((o) => o.annet);
  const steel = items.filter((o) => o.steel);
  const pkOf = (o) => o.pk || "Uten PK";
  const tree = [];

  if (VIEW === "pk") {
    for (const [pk, objs] of [...groupBy(concrete, pkOf)].sort((a, b) => natural(a[0], b[0]))) {
      const children = [...groupBy(objs, (o) => o.ref)]
        .map(([ref, os]) => ({ title: TYPE_NAME.get(ref) || `Ukjent (${ref})`, ref, objs: os }))
        .sort(byRefOrder);
      tree.push({ title: pk, objs, children });
    }
  } else {
    const groups = [...groupBy(concrete, (o) => o.ref)]
      .map(([ref, os]) => ({ title: TYPE_NAME.get(ref) || `Ukjent (${ref})`, ref, objs: os }))
      .sort(byRefOrder);
    for (const g of groups) {
      g.sub = g.ref;
      g.children = [...groupBy(g.objs, pkOf)].sort((a, b) => natural(a[0], b[0])).map(([pk, os]) => ({ title: pk, objs: os }));
      tree.push(g);
    }
  }
  if (steel.length) {
    const order = ["Stålsøyler", "Stålbjelker", "Stålplater", "Annet stål"];
    const children = [...groupBy(steel, (o) => o.steel)].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([r, os]) => ({ title: r, objs: os }));
    tree.push({ title: "Stål", objs: steel, children, noise: true });
  }
  if (noise.length) {
    const order = ["Mangler RefCompClass", "Prefab og isolasjon"];
    const children = [...groupBy(noise, (o) => o.annet)].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([r, os]) => ({ title: r, objs: os }));
    tree.push({ title: "Annet", objs: noise, children, noise: true });
  }
  return tree;
}

function renderTree() {
  selectedRows = new Set(); anchorRow = null;
  ui.treeTitle.textContent = VIEW === "pk" ? "PK-koder" : "Konstruksjonsdeler";
  ui.groups.innerHTML = "";
  const tree = buildTreeData();
  if (!tree.length) { ui.groups.innerHTML = `<div class="hint">Fant ingen betongelementer.</div>`; return; }
  for (const n of tree) ui.groups.appendChild(buildNode(n));
}

function buildNode(n) {
  const d = document.createElement("details");
  if (!n.objs.length) d.classList.add("empty");
  const s = stats(n.objs);
  const sub = n.sub ? ` <span class="n">(${esc(n.sub)})</span>` : "";
  const e = s.eN ? ` <b class="badge" title="Inneholder endringsarbeider">E</b>` : "";
  const amount = n.noise ? `${s.n} stk` : `${nf1.format(s.vol)} m³`;
  d.innerHTML = `<summary>${esc(n.title)}${sub}<span class="n">${amount}</span>${e}</summary>`;
  const body = document.createElement("div");
  body.className = "node-body";
  d.appendChild(body);
  let built = false;
  d.addEventListener("toggle", () => {
    if (d.open && !built) { built = true; buildContent(body, n, s); }
  });
  if (n.children) for (const c of n.children) d.appendChild(buildNode(c));
  return d;
}

function buildContent(body, n, s) {
  body.innerHTML = `<div class="stats">${statsHtml(s)}</div>`;
  const actions = document.createElement("div");
  actions.className = "leaf-actions";
  actions.innerHTML = `<button data-a="select">Velg</button><button data-a="isolate">Isoler</button>` +
    `<button data-a="color">Farge status</button><button data-a="csv">CSV</button>`;
  body.appendChild(actions);
  actions.addEventListener("click", (e) => {
    const a = e.target?.dataset?.a;
    if (a === "select") { clearRowMarks(); select(n.objs); }
    if (a === "isolate") isolate(n.objs);
    if (a === "color") colorByStatus(n.objs);
    if (a === "csv") exportCsv(n.objs, n.title);
  });
  if (n.children) return;

  // Bladnode: liste per type
  const plist = document.createElement("div");
  plist.className = "plist";
  const rows = [];
  for (const [type, os] of [...groupBy(n.objs, (o) => o.type)].sort((a, b) => natural(a[0], b[0]))) {
    const ts = stats(os);
    const row = document.createElement("div");
    row.className = "prow";
    row.title = "Klikk = velg · Ctrl+klikk = legg til/fjern · Shift+klikk = velg område";
    const entry = { el: row, objs: os, rows };
    rows.push(entry);
    row.innerHTML =
      `<span class="pname">${esc(type)}</span>` +
      (ts.eN ? `<b class="badge" title="${ts.eN} endringsarbeider">E</b>` : "") +
      `<span class="pnum">${ts.n} stk</span>` +
      `<span class="pnum">${nf1.format(ts.vol)} m³</span>` +
      `<span class="pnum">${nf1.format(ts.area)} m²</span>`;
    row.addEventListener("mousedown", (e) => { if (e.shiftKey) e.preventDefault(); });
    row.addEventListener("click", (e) => rowClick(entry, e));
    plist.appendChild(row);
  }
  body.appendChild(plist);
}

// ---------- flervalg ----------
let selectedRows = new Set();
let anchorRow = null;

function rowClick(entry, e) {
  const multi = e.ctrlKey || e.metaKey;
  if (e.shiftKey && anchorRow && anchorRow.rows === entry.rows) {
    const a = entry.rows.indexOf(anchorRow), b = entry.rows.indexOf(entry);
    const [from, to] = a < b ? [a, b] : [b, a];
    if (!multi) selectedRows.clear();
    for (let i = from; i <= to; i++) selectedRows.add(entry.rows[i]);
  } else if (multi) {
    if (selectedRows.has(entry)) selectedRows.delete(entry); else selectedRows.add(entry);
    anchorRow = entry;
  } else {
    selectedRows = new Set([entry]);
    anchorRow = entry;
  }
  refreshRowMarks();
  const objs = [...selectedRows].flatMap((r) => r.objs);
  if (!objs.length) {
    safe(() => api.viewer.setSelection(toSelector(entry.objs), "remove"), "Kunne ikke oppheve utvalg");
    return;
  }
  select(objs, !(e.shiftKey || multi));
}
function refreshRowMarks() {
  ui.groups.querySelectorAll(".prow.sel").forEach((r) => r.classList.remove("sel"));
  selectedRows.forEach((r) => r.el.classList.add("sel"));
}
function clearRowMarks() { selectedRows = new Set(); anchorRow = null; refreshRowMarks(); }

// ---------- handlinger ----------
async function select(objs, zoom = true) {
  await safe(async () => {
    const sel = toSelector(objs);
    await api.viewer.setSelection(sel, "set");
    if (zoom) { try { await api.viewer.setCamera(sel, { animationTime: 400 }); } catch (_) { /* valgfritt */ } }
  }, "Kunne ikke velge objekter");
}

async function isolate(objs) {
  await safe(async () => {
    const sel = toSelector(objs).modelObjectIds;
    await api.viewer.setObjectState(undefined, { visible: "reset" });
    let ok = false;
    try { ok = await api.viewer.isolateEntities(sel.map((m) => ({ modelId: m.modelId, entityIds: m.objectRuntimeIds }))); }
    catch (_) { ok = false; }
    if (ok === false) {
      const keep = new Set(objs.map(key));
      for (const m of sel) {
        try {
          const parents = await api.viewer.getHierarchyParents(m.modelId, m.objectRuntimeIds, undefined, true);
          (parents || []).forEach((p) => keep.add(m.modelId + "|" + p.id));
        } catch (_) { /* ingen hierarki */ }
      }
      const hide = allObjects.map((m) => ({ modelId: m.modelId, objectRuntimeIds: m.ids.filter((id) => !keep.has(m.modelId + "|" + id)) }))
        .filter((m) => m.objectRuntimeIds.length);
      if (hide.length) await api.viewer.setObjectState({ modelObjectIds: hide }, { visible: false });
      await api.viewer.setObjectState({ modelObjectIds: sel }, { visible: true });
    }
    setStatus(`Viser ${objs.length} elementer. Trykk «Nullstill» for å vise alt.`);
  }, "Kunne ikke isolere");
}

const HEX = { stopt: "#2EA043", planlagt: "#DA212C", gjenstar: "#0063A3" };

// Setter farge i porsjoner. Prøver RGBA først, deretter hex-tekst hvis Trimble avviser RGBA.
async function setColor(objs, st) {
  const CHUNK = 1000;
  for (let i = 0; i < objs.length; i += CHUNK) {
    const sel = toSelector(objs.slice(i, i + CHUNK));
    try { await api.viewer.setObjectState(sel, { color: COLORS[st] }); }
    catch (e1) {
      console.warn("RGBA avvist, prøver hex", e1);
      await api.viewer.setObjectState(sel, { color: HEX[st] });
    }
  }
}

async function colorByStatus(objs) {
  if (!objs.length) { setStatus("Ingen elementer å fargelegge."); return; }
  await safe(async () => {
    const by = groupBy(objs, (o) => o.status);
    for (const [st, os] of by) {
      setStatus(`Fargelegger ${STATUS_NAME[st].toLowerCase()} (${os.length}) …`);
      await setColor(os, st);
      os.forEach((o) => appliedColors.set(key(o), COLORS[st]));
    }
    // Diagnose: antall per status + eksempel på rå Støpe Dato
    const n = (st) => (by.get(st) || []).length;
    const sample = objs.find((o) => o.dateRaw)?.dateRaw;
    setStatus(
      `Fargelagt ${objs.length} elementer – støpt ${n("stopt")} · planlagt ${n("planlagt")} · gjenstår ${n("gjenstar")} stk.\n` +
      (sample ? `Eksempel Støpe Dato fra modellen: «${sample}»` : "Fant ingen utfylt Støpe Dato – alt regnes som gjenstående.")
    );
  }, "Kunne ikke fargelegge");
}

async function resetAll() {
  await safe(async () => {
    await api.viewer.setObjectState(undefined, { color: "reset", visible: "reset" });
    appliedColors = new Map();
    setStatus("Farger og synlighet er nullstilt.");
  }, "Kunne ikke nullstille");
}

// ---------- CSV ----------
function exportCsv(objs, label) {
  if (!objs.length) { setStatus("Ingenting å eksportere."); return; }
  const n3 = (v) => (Math.round(v * 1000) / 1000).toString().replace(".", ",");
  const head = ["PK", "Elementtype", "RefCompClass", "Type", "Navn", "Byggningsdel", "Endringsarbeid", "Støpe Dato", "Status", "Volum (m³)", "Areal (m²)", "Materiale", "Stål/Annet (årsak)"];
  const rows = objs.map((o) => [o.pk || "", o.steel ? "Stål" : o.annet ? "Annet" : o.refName, o.ref || "", o.type, o.name, o.del, o.endring ? "Ja" : "", fmtDate(o.date), STATUS_NAME[o.status], n3(o.vol), n3(o.area), o.mat, o.steel || o.annet || ""]);
  const cell = (v) => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = "﻿" + [head, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const safeLabel = String(label).replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
  const file = `${PROJECT_FILE}_${safeLabel}_${date}.csv`;
  try {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setStatus(`Eksportert ${objs.length} rader: ${file}`);
  } catch (err) {
    console.error(err);
    setStatus("Kunne ikke lagre CSV: " + (err?.message || err), true);
  }
}

// ---------- sum av utvalg ----------
async function updateSelection() {
  if (!api) return;
  try {
    const sel = await api.viewer.getSelection();
    const objs = [];
    for (const m of sel || []) for (const id of m.objectRuntimeIds || []) {
      const it = itemIndex.get(m.modelId + "|" + id);
      if (it) objs.push(it);
    }
    currentSel = objs;
    ui.csvSel.disabled = objs.length === 0;
    ui.selSum.innerHTML = objs.length ? statsHtml(stats(objs)) : "Ingenting valgt";
  } catch (err) { console.error(err); }
}

// ---------- etiketter (type + m³ per element) ----------
function rotate(q, v) {
  const { x, y, z, w } = q;
  const cx = y * v.z - z * v.y, cy = z * v.x - x * v.z, cz = x * v.y - y * v.x;
  const dx = y * cz - z * cy, dy = z * cx - x * cz, dz = x * cy - y * cx;
  return { x: v.x + 2 * (w * cx + dx), y: v.y + 2 * (w * cy + dy), z: v.z + 2 * (w * cz + dz) };
}
async function cameraAxes() {
  let right = { x: 1, y: 0, z: 0 }, up = { x: 0, y: 0, z: 1 };
  try {
    const cam = await api.viewer.getCamera();
    if (cam && cam.quaternion) { right = rotate(cam.quaternion, { x: 1, y: 0, z: 0 }); up = rotate(cam.quaternion, { x: 0, y: 1, z: 0 }); }
  } catch (_) { /* standard */ }
  const n = (v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
  return { right: n(right), up: n(up) };
}
async function clearLabels() {
  try {
    if (labelIds.length) await api.markup.removeMarkups(labelIds);
    else if (labelTexts.size) {
      const all = await api.markup.getTextMarkups();
      const ids = (all || []).filter((m) => labelTexts.has(m.text) && m.id != null).map((m) => m.id);
      if (ids.length) await api.markup.removeMarkups(ids);
    }
  } catch (err) { console.error(err); }
  labelIds = []; labelTexts = new Set();
}
async function stampLabels() {
  if (labelBusy) return;
  labelBusy = true;
  try {
    await clearLabels();
    await updateSelection();
    const objs = currentSel.slice(0, LABEL_MAX);
    if (!objs.length) { ui.labelInfo.textContent = "Velg elementer i modellen først"; return; }

    const centers = new Map();
    for (const [modelId, os] of groupBy(objs, (o) => o.modelId)) {
      const ids = os.map((o) => o.id);
      for (let i = 0; i < ids.length; i += BATCH) {
        const boxes = (await api.viewer.getObjectBoundingBoxes(modelId, ids.slice(i, i + BATCH))) || [];
        // Enhet er ikke dokumentert. Største utstrekning i utvalget > 500 -> mm, ellers meter.
        const maxExt = Math.max(0, ...boxes.filter((b) => b.boundingBox).map((b) => {
          const bb = b.boundingBox; return Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
        }));
        const k = maxExt > 500 ? 1 : 1000;
        for (const b of boxes) {
          const bb = b.boundingBox; if (!bb) continue;
          centers.set(modelId + "|" + b.id, { x: (bb.min.x + bb.max.x) / 2 * k, y: (bb.min.y + bb.max.y) / 2 * k, z: (bb.min.z + bb.max.z) / 2 * k });
        }
      }
    }
    const { right, up } = await cameraAxes();
    const H = Math.max(100, num(ui.labelOffset.value) || 2000);
    const dir = { x: up.x * H + right.x * H * 0.5, y: up.y * H + right.y * H * 0.5, z: up.z * H + right.z * H * 0.5 };
    const markups = [];
    for (const o of objs) {
      const c = centers.get(key(o)); if (!c) continue;
      markups.push({
        text: `${o.type} · ${nf2.format(o.vol)} m³`,
        color: appliedColors.get(key(o)) || LABEL_DEFAULT,
        start: { positionX: c.x, positionY: c.y, positionZ: c.z, modelId: o.modelId, objectId: o.id },
        end: { positionX: c.x + dir.x, positionY: c.y + dir.y, positionZ: c.z + dir.z },
      });
    }
    const added = await api.markup.addTextMarkup(markups);
    labelIds = (added || []).map((m) => m.id).filter((id) => id != null);
    labelTexts = new Set(markups.map((m) => m.text));
    const cut = currentSel.length > LABEL_MAX ? ` (maks ${LABEL_MAX} av ${currentSel.length})` : "";
    ui.labelInfo.textContent = `${markups.length} etiketter${cut}`;
  } catch (err) {
    console.error(err);
    setStatus("Kunne ikke lage etiketter: " + (err?.message || err), true);
  } finally {
    labelBusy = false;
  }
}

// ---------- diagnose ----------
// Viser alle egenskapssett og egenskaper Trimble gir panelet for første valgte element.
async function diagnose() {
  const out = el("diagOut");
  out.hidden = false;
  out.textContent = "Leser …";
  try {
    const sel = await api.viewer.getSelection();
    const m = (sel || []).find((s) => s.objectRuntimeIds && s.objectRuntimeIds.length);
    if (!m) { out.textContent = "Velg ett element i modellen først."; return; }
    const id = m.objectRuntimeIds[0];
    const [op] = await api.viewer.getObjectProperties(m.modelId, [id]);
    const lines = [
      `Modell: ${m.modelId}`, `Objekt-id: ${id}`,
      `Klasse: ${op?.class ?? "–"}`,
      `Product: ${op?.product ? JSON.stringify(op.product) : "–"}`,
      `Farge: ${op?.color ?? "–"}`, "",
    ];
    for (const ps of op?.properties || []) {
      lines.push(`[${ps.name ?? "(uten navn)"}]`);
      for (const p of ps.properties || []) lines.push(`  ${p.name} = ${String(p.value)}  (type ${p.type}, ${typeof p.value})`);
    }
    const it = itemIndex.get(m.modelId + "|" + id);
    lines.push("", "Panelet tolker dette som:", it
      ? `  PK=${it.pk ?? "–"} · RefCompClass=${it.ref ?? "–"} · Type=${it.type} · Støpe Dato=«${it.dateRaw}» → ${STATUS_NAME[it.status]} · Volum=${nf2.format(it.vol)} m³ · ${it.steel || it.annet || "betong"}`
      : "  (ikke med i skanningen)");
    out.textContent = lines.join("\n");
  } catch (err) {
    out.textContent = "Feil: " + (err?.message || err);
  }
}

// ---------- oppstart ----------
function onEvent(event) {
  if (/onSelectionChanged/i.test(event)) {
    clearTimeout(selTimer);
    selTimer = setTimeout(updateSelection, 300); // bare leser, endrer ingenting i modellen
    return;
  }
  if (/onModel/i.test(event)) {
    items = []; itemIndex = new Map();
    ui.groups.innerHTML = `<div class="hint">Modellene er endret – skann på nytt</div>`;
  }
}

async function init() {
  ui.logo.src = VIEW === "pk" ? "icon-pk.svg" : "icon-konstruksjon.svg";
  ui.title.textContent = VIEW === "pk" ? "TB Betong PK" : "TB Betong Konstruksjon";
  document.title = ui.title.textContent;
  if (typeof TrimbleConnectWorkspace === "undefined") {
    setStatus("Fant ikke Trimble Connect Workspace API. Åpne panelet inne i Trimble Connect.", true);
    return;
  }
  try {
    api = await TrimbleConnectWorkspace.connect(window.parent, onEvent, 30000);
  } catch (err) {
    setStatus("Fikk ikke kontakt med Trimble Connect. Åpne extensionen fra 3D-visningen.", true);
    return;
  }
  ui.rescan.addEventListener("click", scan);
  el("diagBtn").addEventListener("click", diagnose);
  ui.colorAll.addEventListener("click", () => colorByStatus(items.filter((o) => !o.annet && !o.steel)));
  ui.resetColors.addEventListener("click", resetAll);
  ui.csvSel.addEventListener("click", () => exportCsv(currentSel, "utvalg"));
  ui.stampLabels.addEventListener("click", stampLabels);
  ui.clearLabels.addEventListener("click", async () => { await clearLabels(); ui.labelInfo.textContent = "Etiketter fjernet"; });
  await scan();
}

ui.infoBtn.addEventListener("click", () => { ui.infoBox.hidden = !ui.infoBox.hidden; });
init();
