// TB Betong v0.4.0 – Trimble Connect 3D-viewer extension (Total Betong, 1277 Jåtunparken)
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
  rescan: el("rescan"), refreshCustom: el("refreshCustom"), dataInfo: el("dataInfo"),
  floorThick: el("floorThick"), status: el("status"),
};

let api = null;
let items = [];
let itemIndex = new Map();   // "modelId|id" -> item
let allObjects = [];         // [{ modelId, ids }]
let scanning = false;
let appliedColors = new Map();
let labelIds = [], labelTexts = new Set(), labelBusy = false;
let selTimer = null, currentSel = [];
let psetStats = new Map(); // egenskapssett-navn -> { n: antall objekter, props: Set(egenskapsnavn) }

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

// ---------- hurtigminne (localStorage i denne nettleseren) ----------
// IFC-data og GUID lagres per modellversjon (modelId = filversjon) – ny versjon leses automatisk på nytt.
// PK / Støpe Dato / Byggningsdel lagres med tidspunkt og oppdateres med knappen «Oppdater PK / Støpe Dato».
const CACHE_VER = "tcb1";
function cacheGet(k) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (_) { return null; } }
function cacheSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (e) {
    // Fullt: rydd gamle TB-nøkler og prøv én gang til
    try { Object.keys(localStorage).filter((x) => x.startsWith(CACHE_VER + ":")).forEach((x) => localStorage.removeItem(x)); localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (_) { console.warn("Hurtigminne fullt", e); return false; }
  }
}
const fmtTime = (t) => { const d = new Date(t); return `${fmtDate(d)} kl. ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

// Gjør en rå IFC-post om til et element (mengder, støy, status). Kjøres også på hurtigminne-data.
function finalize(modelId, r, thick) {
  const { ref, cls = "", type = "", name = "", mat = "", volRaw = null, gross = null, areal = null } = r;
  let annet = null, steel = null;
  if (!ref) annet = "Mangler RefCompClass";
  else if (/BuildingElementProxy/i.test(cls)) steel = "Stålplater";
  else if (STEEL.test(mat) || STEEL_PROFILE.test(type) || STEEL_PROFILE.test(name)) {
    steel = ref === "ASA" ? "Stålsøyler" : ref === "ABA" ? "Stålbjelker" : "Annet stål";
  }
  else if (NOISE_TYPE.test(type) || NOISE_TYPE.test(name)) annet = "Prefab og isolasjon";

  let vol = volRaw, area = areal ?? gross;
  if (ref === "AOA") { area = gross ?? areal; vol = gross !== null ? gross * thick : volRaw; } // gulv: GrossArea × tykkelse

  const date = parseDate(r.dateRaw || null);
  const del = r.del || "";
  return {
    modelId, id: r.id,
    ref, refName: TYPE_NAME.get(ref) || (ref ? `Ukjent (${ref})` : "–"),
    pk: r.pk || null,
    del, endring: /endringsarbeid/i.test(del),
    type: type || name.replace(/:\d+$/, "") || "(uten type)",
    name, mat,
    date, status: statusOf(date),
    vol: vol ?? 0, area: area ?? 0,
    annet, steel,
    dateRaw: r.dateRaw || "",
  };
}

// ---------- skanning ----------
// mode: "cache" (bruk lagret hvis mulig), "refresh" (lagret IFC/GUID, nye PK/datoer), "full" (alt på nytt)
async function scan(mode = "cache") {
  if (scanning) return;
  scanning = true;
  [ui.rescan, ui.refreshCustom, ui.colorAll, ui.resetColors, ui.stampLabels, ui.clearLabels].forEach((b) => (b.disabled = true));
  const thick = Math.max(0.01, num(ui.floorThick.value) || 0.12);
  const t0 = Date.now();
  let usedIfcCache = false;

  try {
    setStatus("Henter objekter fra modellene …");
    const modelObjects = await api.viewer.getObjects();
    allObjects = (modelObjects || []).map((mo) => ({ modelId: mo.modelId, ids: (mo.objects || []).map((o) => o.id) }));
    psetStats = new Map();
    customLog = [];
    const found = [];
    let total = 0;

    for (const mo of modelObjects || []) {
      const ids = (mo.objects || []).map((o) => o.id);
      total += ids.length;
      const ck = `${CACHE_VER}:ifc:${mo.modelId}`;
      const cached = mode === "full" ? null : cacheGet(ck);
      if (cached && cached.n === ids.length && Array.isArray(cached.raws)) {
        // Samme modellversjon og antall objekter -> bruk lagret
        usedIfcCache = true;
        for (const [n, c, ps] of cached.psets || []) psetStats.set(n, { n: c, props: new Set(ps) });
        for (const r of cached.raws) found.push(finalize(mo.modelId, r, thick));
        clog(`Modell ${mo.modelId}: IFC-data fra hurtigminne (${fmtTime(cached.savedAt)})`);
        continue;
      }
      const raws = [];
      for (let i = 0; i < ids.length; i += BATCH) {
        setStatus(`Leser egenskaper … ${Math.min(i + BATCH, ids.length)} / ${ids.length} objekter`);
        const props = await api.viewer.getObjectProperties(mo.modelId, ids.slice(i, i + BATCH));
        for (const op of props || []) {
          const cls = op.class || "";
          if (SKIP_CLASS.test(cls)) continue;
          const flat = new Map();
          for (const pset of op.properties || []) {
            const psName = pset.name ?? "(uten navn)";
            if (!psetStats.has(psName)) psetStats.set(psName, { n: 0, props: new Set() });
            const st = psetStats.get(psName);
            st.n++;
            for (const p of pset.properties || []) {
              if (st.props.size < 40) st.props.add(p.name);
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

          const dateRaw = pick(flat, P.date);
          const r = {
            id: op.id, cls, ref,
            pk: pk ? String(pk).trim() : null,
            volRaw, gross, areal,
            type: String(pick(flat, P.type) ?? "").trim(),
            name: String((op.product && op.product.name) || pick(flat, P.name) || "").trim(),
            mat: String(pick(flat, P.mat) ?? "").trim(),
            del: String(pick(flat, P.del) ?? "").trim(),
            dateRaw: dateRaw === null ? "" : String(dateRaw), // String() tåler BigInt
          };
          raws.push(r);
          found.push(finalize(mo.modelId, r, thick));
        }
      }
      const psets = [...psetStats].map(([n, s]) => [n, s.n, [...s.props]]);
      if (!cacheSet(ck, { n: ids.length, savedAt: Date.now(), raws, psets })) clog("Kunne ikke lagre IFC-data i hurtigminnet (fullt).");
    }

    items = found;
    itemIndex = new Map(items.map((o) => [key(o), o]));
    await loadCustomProps(mode); // PK Koder, Støpe Dato, Byggningsdel fra Trimble Connect
    renderTree();
    const noise = items.filter((o) => o.annet).length;
    const steelN = items.filter((o) => o.steel).length;
    const withPk = items.filter((o) => o.pk).length;
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    setStatus(`Klar på ${secs} s${usedIfcCache ? " (hurtigminne)" : ""}. ${items.length - noise - steelN} betongelementer, ${steelN} stål, ${noise} i «Annet» (av ${total} objekter). ` +
      `PK funnet på ${withPk}.`);
    [ui.colorAll, ui.resetColors, ui.stampLabels, ui.clearLabels].forEach((b) => (b.disabled = false));
    updateSelection();
  } catch (err) {
    console.error(err);
    setStatus("Feil ved skanning: " + (err?.message || err), true);
  } finally {
    scanning = false;
    ui.rescan.disabled = false;
    ui.refreshCustom.disabled = false;
  }
}

// ---------- egne egenskapssett fra Trimble Connect (PK Koder, Fremdrift, Byggningsdel) ----------
// Disse ligger ikke i IFC-filen, men i Trimble Connect sin Property Set-tjeneste (pset-api).
// Panelet henter dem med brukerens tilgangstoken (godkjennes én gang i Trimble).
const PSET_HOSTS = [
  "https://pset-api.eu-west-1.connect.trimble.com/v1",   // Europa (Norge)
  "https://pset-api.us-east-1.connect.trimble.com/v1",
  "https://pset-api.eu-west-2.connect.trimble.com/v1",
  "https://pset-api.ap-southeast-1.connect.trimble.com/v1",
  "https://pset-api.ap-southeast-2.connect.trimble.com/v1",
];
const IFC64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
let accessToken = null;
let tokenWaiters = [];
let customLog = [];           // vises i Diagnose
const clog = (s) => { customLog.push(s); console.log("[TC-egenskaper]", s); };

// 36-tegns UUID -> 22-tegns IFC-GUID. 22-tegns GUID returneres uendret.
function toIfcGuid(g) {
  const s = String(g || "").trim();
  const hex = s.replace(/[-{}]/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) return s;
  let n = BigInt("0x" + hex), out = "";
  for (let i = 0; i < 22; i++) { out = IFC64[Number(n & 63n)] + out; n >>= 6n; }
  return out;
}

async function getToken() {
  if (accessToken) return accessToken;
  const r = await api.extension.requestPermission("accesstoken");
  if (r && r !== "pending" && r !== "denied") { accessToken = r; return r; }
  if (r === "denied") throw new Error("Tilgang avslått i Trimble. Godkjenn tilgang for extensionen og skann på nytt.");
  clog("Venter på at du godkjenner tilgang i Trimble …");
  setStatus("Godkjenn tilgang i Trimble-dialogen for å hente PK Koder og Støpe Dato …");
  return new Promise((resolve, reject) => {
    tokenWaiters.push(resolve);
    setTimeout(() => reject(new Error("Fikk ikke tilgangstoken innen 90 sekunder.")), 90000);
  });
}

async function psetGet(host, path) {
  const res = await fetch(host + path, { headers: { Authorization: "Bearer " + (await getToken()), Accept: "application/json" } });
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

// Runtime-id -> IFC-GUID for alle elementer. Lagres per modellversjon (endres aldri innen en versjon).
async function loadGuids(objs, force = false) {
  const guid = new Map();
  for (const [modelId, os] of groupBy(objs, (o) => o.modelId)) {
    const ck = `${CACHE_VER}:guid:${modelId}`;
    const cached = force ? null : cacheGet(ck);
    const known = (cached && cached.map) || {};
    const missing = [];
    for (const o of os) { const g = known[o.id]; if (g) guid.set(modelId + "|" + o.id, g); else missing.push(o.id); }
    if (!missing.length) { clog(`Modell ${modelId}: GUID fra hurtigminne (${os.length})`); continue; }

    // Del porsjonen i to ved feil (raskere enn én og én)
    const conv = async (chunk) => {
      try {
        const ext = await api.viewer.convertToObjectIds(modelId, chunk);
        chunk.forEach((id, i) => { if (ext && ext[i]) { const g = toIfcGuid(ext[i]); guid.set(modelId + "|" + id, g); known[id] = g; } });
      } catch (e) {
        if (chunk.length > 1) {
          const h = Math.ceil(chunk.length / 2);
          await conv(chunk.slice(0, h));
          await conv(chunk.slice(h));
        }
      }
    };
    for (let i = 0; i < missing.length; i += 500) {
      setStatus(`Henter GUID … ${Math.min(i + 500, missing.length)} / ${missing.length} (lagres for neste gang)`);
      await conv(missing.slice(i, i + 500));
    }
    cacheSet(ck, { savedAt: Date.now(), map: known });
    clog(`Modell ${modelId}: GUID hentet for ${missing.length} elementer og lagret`);
  }
  return guid;
}

// Fletter inn PK / Støpe Dato / Byggningsdel. values: Map(link -> { pk, date, del }). Returnerer antall treff.
function applyCustom(values, guid) {
  let hitPk = 0, hitDate = 0, hitDel = 0, hits = 0;
  for (const o of items) {
    const g = guid.get(key(o)); if (!g) continue;
    const v = values.get("frn:entity:" + g) || values.get("frn:entity:" + encodeURIComponent(g));
    if (!v) continue;
    hits++;
    if (v.pk) { o.pk = String(v.pk).trim(); hitPk++; }
    if (v.del) { o.del = String(v.del).trim(); o.endring = /endringsarbeid/i.test(o.del); hitDel++; }
    if (v.date) { o.dateRaw = String(v.date); o.date = parseDate(v.date); o.status = statusOf(o.date); hitDate++; }
  }
  clog(`Flettet inn: PK ${hitPk} · Støpe Dato ${hitDate} · Byggningsdel ${hitDel} (av ${items.length})`);
  return hits;
}
let customSavedAt = null; // når PK/Støpe Dato sist ble hentet fra Trimble
function updateDataInfo() {
  if (!ui.dataInfo) return;
  ui.dataInfo.textContent = customSavedAt
    ? `PK / Støpe Dato hentet ${fmtTime(customSavedAt)}`
    : "PK / Støpe Dato: ikke hentet ennå";
}

// Finn rolle (pk / date / del) for en egenskap ut fra navn i definisjonen
function roleOf(defName, label, propCount) {
  const l = normName(label), d = normName(defName);
  if (P.pk.some((n) => normName(n) === l) || (/^pk/.test(d) && propCount === 1)) return "pk";
  if (P.date.some((n) => normName(n) === l) || /st(ø|o)pe/.test(l)) return "date";
  if (P.del.some((n) => normName(n) === l) || (/byg+ningsdel/.test(d) && propCount === 1)) return "del";
  return null;
}

// Hovedfunksjon: henter og fletter inn PK, Støpe Dato og Byggningsdel
async function loadCustomProps(mode = "cache") {
  if (!items.length) return;
  try {
    const guid = await loadGuids(items, mode === "full");
    clog(`GUID for ${guid.size} av ${items.length} elementer. Eksempel: ${[...guid.values()][0] || "–"}`);
    if (!guid.size) return;

    // Hurtigminne: bruk sist hentede PK/Støpe Dato hvis de passer til modellen
    const CK = `${CACHE_VER}:custom`;
    if (mode === "cache") {
      const cc = cacheGet(CK);
      if (cc && cc.values) {
        const hits = applyCustom(new Map(Object.entries(cc.values)), guid);
        if (hits > 0) {
          customSavedAt = cc.savedAt;
          clog(`PK/Støpe Dato fra hurtigminne (${fmtTime(cc.savedAt)}). Trykk «Oppdater PK / Støpe Dato» for nyeste.`);
          updateDataInfo();
          return;
        }
      }
    }

    await getToken();
    clog("Tilgangstoken: OK");

    // Region og egenskapssett-oppsett huskes, så «Oppdater» bare henter verdiene
    const CFG = `${CACHE_VER}:psetcfg`;
    const cfg = mode === "full" ? null : cacheGet(CFG);
    let host = null, wanted = [];
    if (cfg && cfg.host && Array.isArray(cfg.wanted) && cfg.wanted.length) {
      host = cfg.host; wanted = cfg.wanted;
      clog(`Oppsett fra hurtigminne: ${host.split("//")[1].split("/")[0]}, ${wanted.length} egenskaper`);
    } else {
    // 1) Oppdag region og egenskapssett-definisjoner ved å prøve noen elementer
    const samples = items.filter((o) => guid.has(key(o)) && !o.annet && !o.steel).slice(0, 40);
    const defs = new Map(); // "libId|defId" -> { libId, defId }
    // To måter å kode lenken i adressen på; den som gir treff huskes
    const variants = [
      (g) => encodeURIComponent("frn:entity:" + g),
      (g) => "frn:entity:" + encodeURIComponent(g),
    ];
    let vIdx = null, tried = 0;
    for (const o of samples) {
      const g = guid.get(key(o));
      for (const h of host ? [host] : PSET_HOSTS) {
        let reached = false;
        for (const vi of vIdx !== null ? [vIdx] : [0, 1]) {
          try {
            const page = await psetGet(h, "/psets/" + variants[vi](g));
            reached = true;
            const its = page.items || [];
            if (!host) { host = h; clog(`Region: ${h.replace("https://", "").split("/")[0]}`); }
            if (its.length) {
              if (vIdx === null) { vIdx = vi; clog(`Lenkeformat ${vi + 1} gir treff (frn:entity:${g})`); }
              its.forEach((p) => defs.set(p.libId + "|" + p.defId, { libId: p.libId, defId: p.defId }));
              break;
            }
          } catch (e) {
            if (e instanceof TypeError) clog("Nettverksfeil/CORS mot " + h.split("//")[1].split("/")[0] + ": " + e.message);
            else if (tried < 6) clog(`${h.split("//")[1].split("/")[0]} (format ${vi + 1}): ${e.message}`);
          }
        }
        tried++;
        if (reached) break;
      }
      if (defs.size >= 3) break;
    }
    if (host && !defs.size) clog(`Region svarte, men ingen av ${samples.length} prøve-elementer hadde egne egenskapssett.`);
    if (!host || !defs.size) { clog("Fant ingen egne egenskapssett på prøve-elementene."); return; }

    // 2) Hent definisjonene (navn og egenskaper) og finn hvilke egenskaper vi trenger
    wanted = []; // { libId, defId, propKey, role }
    for (const { libId, defId } of defs.values()) {
      let def;
      try { def = await psetGet(host, `/libs/${encodeURIComponent(libId)}/defs/${encodeURIComponent(defId)}`); }
      catch (e) { clog(`Definisjon ${defId}: ${e.message}`); continue; }
      const props = (def.schema && def.schema.props) || {};
      const keys = Object.keys(props);
      const i18nText = JSON.stringify(def.i18n || {});
      clog(`Sett «${def.name ?? defId}»: ${keys.join(", ") || "(ingen)"}`);
      for (const k of keys) {
        // Visningsnavn: title i skjema, oversettelse i i18n, ellers nøkkelen
        let label = props[k].title || props[k].description || k;
        const m = new RegExp(`"[^"]*${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"]*"\\s*:\\s*"([^"]+)"`).exec(i18nText);
        if (m) label = m[1];
        const role = roleOf(def.name || "", label, keys.length) || roleOf(def.name || "", k, keys.length);
        if (role) { wanted.push({ libId, defId, propKey: k, role }); clog(`  → «${label}» (${k}) brukes som ${role}`); }
      }
    }
    if (!wanted.length) { clog("Fant ikke PK/Støpe Dato/Byggningsdel blant egenskapene."); return; }
    cacheSet(CFG, { savedAt: Date.now(), host, wanted });
    } // slutt på oppdagelse

    // 3) Hent alle verdier per definisjon (sider à 500) -> link -> props
    const values = new Map(); // link -> { pk, date, del }
    for (const [dk, ws] of groupBy(wanted, (w) => w.libId + "|" + w.defId)) {
      const { libId, defId } = ws[0];
      let path = `/libs/${encodeURIComponent(libId)}/defs/${encodeURIComponent(defId)}/psets?top=500`, pages = 0, n = 0;
      while (path && pages < 200) {
        const page = await psetGet(host, path);
        for (const ps of page.items || []) {
          if (ps.deleted) continue;
          const v = values.get(ps.link) || {};
          for (const w of ws) { const val = ps.props ? ps.props[w.propKey] : undefined; if (val !== undefined && val !== null && val !== "") v[w.role] = val; }
          values.set(ps.link, v); n++;
        }
        pages++;
        setStatus(`Henter Trimble-egenskaper … ${n} verdier`);
        // "next" kan være full URL eller sti
        path = page.next ? (page.next.startsWith("http") ? page.next.replace(host, "") : page.next) : null;
      }
      clog(`Sett ${defId}: ${n} verdier hentet`);
    }

    if (!values.size && cfg) {
      try { localStorage.removeItem(CFG); } catch (_) { /* ignorer */ }
      clog("Ingen verdier med lagret oppsett – oppsettet er nullstilt. Trykk «Les modellen på nytt».");
    }
    // 4) Flett inn og lagre
    applyCustom(values, guid);
    customSavedAt = Date.now();
    if (!cacheSet(CK, { savedAt: customSavedAt, values: Object.fromEntries(values) })) clog("Kunne ikke lagre PK/Støpe Dato i hurtigminnet.");
    updateDataInfo();
  } catch (err) {
    console.error(err);
    clog("Feil: " + (err?.message || err));
    setStatus("Kunne ikke hente PK/Støpe Dato fra Trimble Connect: " + (err?.message || err), true);
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
  // Del 1: alle egenskapssett i modellen (fra skanningen) – virker uten utvalg
  const sets = [...psetStats].sort((a, b) => natural(a[0], b[0]));
  const head = ["TRIMBLE CONNECT-EGENSKAPER (PK Koder / Fremdrift / Byggningsdel):",
    ...(customLog.length ? customLog.map((s) => "  " + s) : ["  (ikke kjørt – trykk «Skann modellene på nytt»)"]), "",
    `EGENSKAPSSETT I IFC-MODELLEN (${sets.length}):`,
    ...sets.map(([n, s]) => `  ${n}  (${s.n} obj): ${[...s.props].slice(0, 12).join(", ")}${s.props.size > 12 ? " …" : ""}`),
    "", "VALGT ELEMENT:"];
  try {
    const sel = await api.viewer.getSelection();
    let m = (sel || []).find((s) => s.objectRuntimeIds && s.objectRuntimeIds.length);
    // Reserve: bruk det panelet allerede viser under «Valgt i modellen»
    if (!m && currentSel.length) m = { modelId: currentSel[0].modelId, objectRuntimeIds: [currentSel[0].id] };
    if (!m) { out.textContent = head.join("\n") + "\n  (ingenting valgt)"; return; }
    const id = m.objectRuntimeIds[0];
    const [op] = await api.viewer.getObjectProperties(m.modelId, [id]);
    // BigInt (datoer) kan ikke skrives med vanlig JSON -> gjør om til tekst
    const js = (v) => JSON.stringify(v, (k, x) => (typeof x === "bigint" ? `${x}n` : x));
    const lines = [...head,
      `Modell: ${m.modelId}`, `Objekt-id: ${id}`,
      `Klasse: ${op?.class ?? "–"}`,
      `Product: ${op?.product ? js(op.product) : "–"}`,
      `Farge: ${op?.color ?? "–"}`,
      `Antall egenskapssett: ${(op?.properties || []).length}`, "",
    ];
    for (const ps of op?.properties || []) {
      lines.push(`[${ps.name ?? "(uten navn)"}]`);
      for (const p of ps.properties || []) {
        let v;
        try { v = typeof p.value === "bigint" ? `${p.value} (BigInt → ${fmtDate(parseDate(p.value)) || "?"})` : String(p.value); }
        catch (_) { v = "(kan ikke vises)"; }
        lines.push(`  ${p.name} = ${v}  (type ${p.type}, ${typeof p.value})`);
      }
    }
    // Andre felt på objektet enn de kjente (i tilfelle egne egenskaper ligger et annet sted)
    const extra = Object.keys(op || {}).filter((k) => !["id", "class", "product", "properties", "color", "position"].includes(k));
    if (extra.length) lines.push("", "Andre felt:", ...extra.map((k) => `  ${k}: ${js(op[k]).slice(0, 300)}`));
    const it = itemIndex.get(m.modelId + "|" + id);
    lines.push("", "Panelet tolker dette som:", it
      ? `  PK=${it.pk ?? "–"} · RefCompClass=${it.ref ?? "–"} · Type=${it.type} · Støpe Dato=«${it.dateRaw}» → ${STATUS_NAME[it.status]} · Volum=${nf2.format(it.vol)} m³ · ${it.steel || it.annet || "betong"}`
      : "  (ikke med i skanningen)");
    out.textContent = lines.join("\n");
  } catch (err) {
    out.textContent = head.join("\n") + "\n  Feil: " + (err?.message || err);
  }
}

// ---------- oppstart ----------
function onEvent(event, args) {
  // Tilgangstoken (første gang etter godkjenning, og ved hver fornyelse)
  if (event === "extension.accessToken") {
    const t = args && (args.data ?? args);
    if (typeof t === "string" && t !== "pending" && t !== "denied") {
      accessToken = t;
      tokenWaiters.forEach((r) => r(t));
      tokenWaiters = [];
    }
    return;
  }
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
  ui.rescan.addEventListener("click", () => scan("full"));          // alt på nytt (tar tid)
  ui.refreshCustom.addEventListener("click", () => scan("refresh")); // bare nyeste PK/Støpe Dato
  el("diagBtn").addEventListener("click", diagnose);
  ui.colorAll.addEventListener("click", () => colorByStatus(items.filter((o) => !o.annet && !o.steel)));
  ui.resetColors.addEventListener("click", resetAll);
  ui.csvSel.addEventListener("click", () => exportCsv(currentSel, "utvalg"));
  ui.stampLabels.addEventListener("click", stampLabels);
  ui.clearLabels.addEventListener("click", async () => { await clearLabels(); ui.labelInfo.textContent = "Etiketter fjernet"; });
  await scan("cache"); // åpner raskt fra hurtigminnet hvis modellversjonen er lest før
}

ui.infoBtn.addEventListener("click", () => { ui.infoBox.hidden = !ui.infoBox.hidden; });
init();
