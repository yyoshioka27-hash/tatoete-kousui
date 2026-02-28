// script.js  (FULL)
// ✅ FIX: ランキングが「たとえを変える」でチカチカする問題
// ✅ 仕様：ランキングは
//   1) 検索（候補選択→天気取得成功）後に表示して固定
//   2) それ以降は「再度検索するまで」変えない
//   3) ただし「モード切替時」はランキング更新したい
//   4) 候補を変えただけ（同じ地点名でも lat/lon が違えば）でも更新したい
// =========================

// =========================
// ✅ BUILD（反映確認用）
// =========================
const BUILD = "2026-02-27_latestfold_rank2__SCRIPT_FULL_v3";

// ✅ API_BASE（/api/health がOKの“正”）
const API_BASE = "https://ancient-union-4aa4tatoete-kousui-api.y-yoshioka27.workers.dev";

// =========================
// ✅ 端末ID（いいね巻き添え防止用）
// =========================
function getClientId(){
  let id = localStorage.getItem("clientId");
  if(!id){
    id = (crypto.randomUUID ? crypto.randomUUID()
      : (Date.now() + "-" + Math.random().toString(16).slice(2)));
    localStorage.setItem("clientId", id);
  }
  return id;
}

// ==============================
// ✅ 今日の使用者カウント（DAU）
// ==============================
function todayJSTString(){
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function getOrCreateDeviceId(){
  const key = "usage_device_id_v1";
  try{
    let v = localStorage.getItem(key);
    if (v && v.length >= 16) return v;
    const r = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
    v = `d_${r()}${r()}`;
    localStorage.setItem(key, v);
    return v;
  }catch{
    const r = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
    return `d_${r()}${r()}`;
  }
}

async function pingUsageOncePerDay(reason="wx_ok"){
  const dayKey = "usage_ping_day_v1";
  const day = todayJSTString();

  try{
    const done = localStorage.getItem(dayKey);
    if (done === day) return;
  }catch{}

  const deviceId = getOrCreateDeviceId();
  const url = `${API_BASE}/api/usage/ping?d=${encodeURIComponent(deviceId)}&r=${encodeURIComponent(reason)}&v=${encodeURIComponent(BUILD)}`;

  try{
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 4000);

    let res, data;
    try{
      res = await fetch(url, {
        method:"POST",
        cache:"no-store",
        signal: ac.signal,
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ deviceId, reason, v: BUILD })
      });
      data = await res.json().catch(()=>null);
    } finally {
      clearTimeout(t);
    }

    if (res.ok && data?.ok) {
      try{ localStorage.setItem(dayKey, day); }catch{}
      return;
    }

    console.warn("usage ping not ok", res?.status, data);
  }catch(e){
    console.warn("usage ping failed", e?.message || e);
  }
}

// =========================
// ✅ render 多重呼び出し防止
// =========================
let __renderQueued = false;
function scheduleRender(){
  if (__renderQueued) return;
  __renderQueued = true;
  requestAnimationFrame(() => {
    __renderQueued = false;
    try { render(); } catch (e) { console.warn("render error", e); }
  });
}

// =========================
// ✅ NGワード
// =========================
const NG_PHRASES = [
  "共通テスト",
];

function isNgText(text){
  const t = String(text || "");
  if (!t) return true;
  return NG_PHRASES.some(ng => ng && t.includes(ng));
}

// ✅ ネタ本文内の「xx%」がバケットと一致しない場合は除外する
function hasMismatchedPercent(text, bucket){
  try{
    const t = String(text || "");
    const b = Number(bucket);
    if (!Number.isFinite(b)) return false;

    const re = /(\d{1,3})\s*%/g;
    let m;
    while ((m = re.exec(t)) !== null){
      const p = Number(m[1]);
      if (!Number.isFinite(p)) continue;
      if (p < 0 || p > 100) continue;
      if (p !== b) return true;
    }
    return false;
  }catch{
    return false;
  }
}

function hasHard100PercentMismatch(text, bucket){
  try{
    const t = String(text || "");
    const b = Number(bucket);
    if (!Number.isFinite(b)) return false;
    if (b === 100) return false;
    return /100\s*(%|％)/.test(t);
  }catch{
    return false;
  }
}

// =========================
// ✅ いいね演出CSS
// =========================
(function injectLikeFxCSS(){
  const id = "likeFxCSS_v1";
  if (document.getElementById(id)) return;

  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .like-btn-pop { transform: scale(1.0); transition: transform 120ms ease; }
    .like-btn-pop.__pop { transform: scale(1.10); }
    .like-plusone {
      position: absolute;
      font-weight: 900;
      pointer-events: none;
      user-select: none;
      transform: translateY(0);
      opacity: 1;
      transition: transform 520ms ease, opacity 520ms ease;
      text-shadow: 0 2px 10px rgba(0,0,0,0.10);
    }
    .like-plusone.__fly { transform: translateY(-18px); opacity: 0; }

    .pen-muted { opacity: .55; font-weight: 700; }

    .hof-badge{
      display:inline-block;
      padding:2px 8px;
      border-radius:999px;
      font-weight:900;
      font-size:12px;
      border:1px solid rgba(15,23,42,.18);
      background: rgba(255,255,255,.75);
      margin-left:6px;
    }

    /* ✅ 最新枠のdetails見た目 */
    .latest-details summary{
      cursor:pointer;
      user-select:none;
      font-weight:900;
      list-style:none;
    }
    .latest-details summary::-webkit-details-marker{ display:none; }

     /* ✅ モードバッジ（雑学=薄青 / お笑い=薄緑） */
  .mode-badge{
    display:inline-block;
    padding:2px 8px;
    border-radius:999px;
    font-weight:900;
    font-size:12px;
    border:1px solid rgba(15,23,42,.12);
    margin-left:6px;
    vertical-align:middle;
  }
  .mode-badge.trivia{
    background: rgba(59,130,246,.14);
    border-color: rgba(59,130,246,.28);
    color: rgba(30,58,138,.95);
  }
  .mode-badge.fun{
    background: rgba(34,197,94,.14);
    border-color: rgba(34,197,94,.28);
    color: rgba(20,83,45,.95);
  }
`;
document.head.appendChild(style);
})();
function likeFxPop(btnEl){
  try{
    btnEl.classList.add("__pop");
    setTimeout(() => btnEl.classList.remove("__pop"), 140);
  }catch{}
}

function likeFxPlusOne(btnEl){
  try{
    const parent = btnEl.parentElement;
    if (!parent) return;
    const cs = window.getComputedStyle(parent);
    if (cs.position === "static") parent.style.position = "relative";

    const plus = document.createElement("span");
    plus.className = "like-plusone";
    plus.textContent = "+1";

    plus.style.left = (btnEl.offsetLeft + btnEl.offsetWidth - 6) + "px";
    plus.style.top  = (btnEl.offsetTop - 6) + "px";

    parent.appendChild(plus);
    requestAnimationFrame(() => { plus.classList.add("__fly"); });
    setTimeout(() => { try{ plus.remove(); }catch{} }, 700);
  }catch{}
}

// ==============================
// ✅ 合言葉（PIN）入力欄をJS側で自動生成
// ==============================
(function ensurePenPinDom(){
  const pen = document.getElementById("penName");
  if (!pen) return;
  if (document.getElementById("penPin")) return;

  const pin = document.createElement("input");
  pin.id = "penPin";
  pin.type = "text";
  pin.style.webkitTextSecurity = "disc";
  pin.setAttribute("inputmode", "text");
  pin.setAttribute("lang", "ja");
  pin.autocomplete = "off";
  pin.autocapitalize = "none";
  pin.autocorrect = "off";
  pin.spellcheck = false;
  pin.placeholder = "合言葉（初回登録/別端末ログイン用）";
  pin.style.width = "100%";
  pin.style.boxSizing = "border-box";
  pin.style.marginTop = "8px";
  pin.style.padding = "12px 14px";
  pin.style.borderRadius = "12px";
  pin.style.border = "1px solid rgba(15,23,42,.12)";

  const note = document.createElement("div");
  note.className = "muted";
  note.style.marginTop = "6px";
  note.textContent = "※合言葉は一般公開されません。忘れるとそのペンネームは使えません（救済なし）。";

  pen.insertAdjacentElement("afterend", pin);
  pin.insertAdjacentElement("afterend", note);
})();

// ==============================
// ✅ モバイルで「雑学/お笑い」位置ズレ整列
// ==============================
function fixModeToggleAlignment(){
  try{
    const inputs = Array.from(document.querySelectorAll('input[name="mode"]'));
    if (!inputs.length) return;

    const labels = inputs.map(inp => {
      const a = inp.closest("label");
      if (a) return a;
      if (inp.id) {
        const b = document.querySelector(`label[for="${CSS.escape(inp.id)}"]`);
        if (b) return b;
      }
      return null;
    }).filter(Boolean);

    if (labels.length < 2) return;

    const parent = labels[0].parentElement;
    if (parent){
      parent.style.display = "flex";
      parent.style.gap = "10px";
      parent.style.justifyContent = "center";
      parent.style.alignItems = "stretch";
      parent.style.flexWrap = "wrap";
    }

    labels.forEach(lab => {
      lab.style.display = "inline-flex";
      lab.style.alignItems = "center";
      lab.style.justifyContent = "center";
      lab.style.minWidth = "120px";
      lab.style.height = "44px";
      lab.style.lineHeight = "1";
      lab.style.boxSizing = "border-box";
      lab.style.padding = "0 12px";
      lab.style.whiteSpace = "nowrap";
      lab.style.textAlign = "center";
    });

    inputs.forEach(inp => { inp.style.marginRight = "6px"; });
  }catch(e){
    console.warn("fixModeToggleAlignment error", e);
  }
}

// ==============================
// UI helper
// ==============================
const $ = (id) => document.getElementById(id);

function setStatus(text, kind="muted") {
  const el = document.getElementById("placeStatus");
  if (!el) return;
  el.className = kind;
  el.textContent = text;
}

function normalizePlaceName(input) {
  return input
    .replace(/[ 　]+/g, " ")
    .replace(/(都|道|府|県|市|区|町|村)$/g, "")
    .replace(/(都|道|府|県|市|区|町|村)/g, "")
    .trim();
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// =========================
// ✅ 復旧（reindex）案内UI
// =========================
function ensureReindexHintDom(){
  if (document.getElementById("reindexHint")) return;

  const target = document.getElementById("todayRankingWrap")
              || document.getElementById("placeStatus")
              || document.body;

  const box = document.createElement("div");
  box.id = "reindexHint";
  box.style.display = "none";
  box.style.maxWidth = "760px";
  box.style.margin = "12px auto 0 auto";
  box.style.padding = "12px 14px";
  box.style.borderRadius = "14px";
  box.style.border = "1px solid rgba(239,68,68,.25)";
  box.style.background = "rgba(254, 226, 226, .75)";
  box.style.color = "#7f1d1d";
  box.style.fontWeight = "900";
  box.style.boxShadow = "0 10px 24px rgba(2,6,23,.08)";
  box.style.lineHeight = "1.35";

  box.innerHTML = `
    <div style="font-size:14px;">⚠️ 公開ネタの目次（index）が空の可能性があります</div>
    <div style="margin-top:6px; font-weight:700; font-size:12px;">
      管理画面（admin.html）で <b>「復旧（reindex）」</b> を押してください。<br>
      ※投稿データ本体は消えず、一覧（idx）を作り直す処理です。
    </div>
  `;

  if (target && target.id === "todayRankingWrap" && target.parentElement){
    target.parentElement.insertBefore(box, target);
  } else if (target && target !== document.body) {
    target.insertAdjacentElement("afterend", box);
  } else {
    document.body.appendChild(box);
  }
}

function setReindexHint(need, detailText){
  try{
    ensureReindexHintDom();
    const el = document.getElementById("reindexHint");
    if (!el) return;

    if (!need){
      el.style.display = "none";
      return;
    }

    if (detailText){
      const lines = el.querySelectorAll("div");
      if (lines && lines[1]) {
        lines[1].innerHTML = `<span style="font-weight:700; font-size:12px;">${escapeHtml(detailText)}</span>`;
      }
    }

    el.style.display = "";
  }catch(e){
    console.warn("setReindexHint error", e);
  }
}

// ✅ ペンネーム表示ルール
function normalizePenName(name){
  const n = String(name || "").trim();
  if (!n) return null;
  if (n === "匿名") return null;
  if (n === "初期ネタ") return null;
  return n;
}
function penHtmlIfAny(name){
  const n = normalizePenName(name);
  return n ? ` <span class="muted">（${escapeHtml(n)}）</span>` : "";
}
function modeBadgeHtml(mode){
  const m = (mode === "fun") ? "fun" : "trivia";
  const label = (m === "fun") ? "お笑い" : "雑学";
  return ` <span class="mode-badge ${m}">${label}</span>`;
}
// ==============================
// 承認待ち投稿（Workers）
// ==============================
async function submitToPending(mode, bucket, text, penName, penPin, clientId){
  const res = await fetch(`${API_BASE}/api/submit`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ mode, bucket, text, penName, penPin, clientId, from: "mobile" })
  });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) {
    const code = data?.code || data?.error || `submit failed ${res.status}`;
    throw new Error(code);
  }
  return data;
}

// ==============================
// publicネタ取得（Workers）
// ==============================
async function fetchPublicMetaphors({ mode, bucket, limit = 50 }) {
  const params = new URLSearchParams();
  if (mode) params.set("mode", mode);
  if (Number.isFinite(bucket)) params.set("bucket", String(bucket));
  params.set("limit", String(limit));

  const url = `${API_BASE}/api/public?${params.toString()}`;
  const res = await fetch(url, { method: "GET", cache: "no-store" });

  if (!res.ok){
    setReindexHint(false);
    throw new Error(`public fetch failed: ${res.status}`);
  }

  const data = await res.json().catch(()=>null);
  if (!data?.ok) {
    setReindexHint(false);
    throw new Error("public not ok");
  }

  try{
    const note = String(data?.note || "");
    const itemsRaw = Array.isArray(data?.items) ? data.items : [];
    if (data?.ok === true && note === "no_index_or_empty" && itemsRaw.length === 0){
      setReindexHint(true, "公開ネタが0件です（no_index_or_empty）。管理画面で「復旧（reindex）」を実行してください。");
    } else {
      setReindexHint(false);
    }
  }catch{}

  state.hofThreshold = Number(data.hofThreshold || state.hofThreshold || 20);

  const items = Array.isArray(data.items) ? data.items : [];
  return items
    .map(it => ({
      id: String(it.id || "").trim(),
      text: String(it.text || "").trim(),
      penName: (it.penName ? String(it.penName).trim() : null),
      totalLikes: Number(it.totalLikes || 0),
      hof: !!it.hof
    }))
    .filter(x => x.id && x.text)
    .filter(x => !isNgText(x.text));
}

// ==============================
// ✅ 最新public（Workers /api/public_latest）
// ==============================
async function fetchPublicLatest(mode, limit = 10){
  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("limit", String(limit));

  const res = await fetch(`${API_BASE}/api/public_latest?${params.toString()}`, { method:"GET", cache:"no-store" });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `public_latest failed ${res.status}`);

  if (data.hofThreshold != null) state.hofThreshold = Number(data.hofThreshold || state.hofThreshold || 20);

  const items = Array.isArray(data.items) ? data.items : [];
  return items
    .map(it => ({
      id: String(it.id || "").trim(),
      text: String(it.text || "").trim(),
      penName: it.penName ? String(it.penName).trim() : null,
      bucket: Number(it.bucket ?? 0),
      approvedAt: it.approvedAt ?? null,
      mode: (it.mode === "fun" ? "fun" : "trivia"),
    }))
    .filter(x => x.id && x.text)
    .filter(x => !isNgText(x.text));
}

// ==============================
// ✅ いいね（Workers）
// ==============================
async function likeAny(payload){
  const cid = getClientId();
  const res = await fetch(`${API_BASE}/api/like`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type":"application/json",
      "x-client-id": cid,
    },
    body: JSON.stringify({
      ...payload,
      clientId: cid,
    })
  });

  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `like failed ${res.status}`);

  if (data.hofThreshold != null) state.hofThreshold = Number(data.hofThreshold || state.hofThreshold || 20);
  return data;
}

// ==============================
// 今日のランキング（Workers）
// ==============================
async function fetchRankingToday(mode, bucket, limit = 3){
  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("bucket", String(bucket));
  params.set("limit", String(limit));
  const res = await fetch(`${API_BASE}/api/ranking/today?${params.toString()}`, { method:"GET", cache:"no-store" });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `ranking failed ${res.status}`);
  return Array.isArray(data.items) ? data.items : [];
}

// ✅ 今日の総合ランキング（全バケット共通）
async function fetchRankingTodayAll(mode, limit = 3){
  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("limit", String(limit));
  const res = await fetch(`${API_BASE}/api/ranking/today_all?${params.toString()}`, { method:"GET", cache:"no-store" });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `ranking today_all failed ${res.status}`);
  return Array.isArray(data.items) ? data.items : [];
}

async function fetchRankingTotal(mode, bucket, limit = 3){
  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("bucket", String(bucket));
  params.set("limit", String(limit));
  const res = await fetch(`${API_BASE}/api/ranking/total?${params.toString()}`, { method:"GET", cache:"no-store" });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `ranking total failed ${res.status}`);
  if (data.hofThreshold != null) state.hofThreshold = Number(data.hofThreshold || state.hofThreshold || 20);
  return Array.isArray(data.items) ? data.items : [];
}

// ✅ 殿堂入り（全バケット共通）
async function fetchHallOfFame(mode, bucket, limit = 50){
  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("limit", String(limit));
  params.set("scope", "all");
  const res = await fetch(`${API_BASE}/api/hof?${params.toString()}`, { method:"GET", cache:"no-store" });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `hof failed ${res.status}`);
  if (data.hofThreshold != null) state.hofThreshold = Number(data.hofThreshold || state.hofThreshold || 20);
  return Array.isArray(data.items) ? data.items : [];
}

// ==============================
// 共有ネタ（GitHub PagesのJSON / metaphors.json）
// ==============================
const SHARED_JSON_URL = "./metaphors.json";
let sharedItems = [];
window.JSON_METAPHORS = window.JSON_METAPHORS || [];

async function loadSharedJSON() {
  try {
    const res = await fetch(`${SHARED_JSON_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`shared json http ${res.status}`);

    const json = await res.json();
    const items = Array.isArray(json?.items) ? json.items : [];

    sharedItems = items
      .map(it => ({
        mode: (it.mode === "fun" ? "fun" : "trivia"),
        bucket: window.bucket10(Number(it.bucket)),
        text: String(it.text || "").trim()
      }))
      .filter(it => it.text)
      .filter(it => !isNgText(it.text));

    window.JSON_METAPHORS = items || [];
  } catch {
    sharedItems = [];
    window.JSON_METAPHORS = [];
  }
}

function getSharedItems(mode, bucket) {
  const m = (mode === "fun" ? "fun" : "trivia");
  const b = window.bucket10(bucket);

  const base = (sharedItems && sharedItems.length)
    ? sharedItems
    : (Array.isArray(window.JSON_METAPHORS) ? window.JSON_METAPHORS.map(it => ({
        mode: (it?.mode === "fun" ? "fun" : "trivia"),
        bucket: window.bucket10(Number(it?.bucket)),
        text: String(it?.text || "").trim()
      })).filter(x => x.text) : []);

  return base
    .filter(x => x.mode === m && x.bucket === b)
    .filter(x => !isNgText(x.text));
}

// ==============================
// ✅ publicネタ（Workers /api/public）キャッシュ
// ==============================
const publicCache = new Map(); // "mode_bucket" => [{id,text,penName,totalLikes,hof}, ...]

function keyMB(mode, bucket){
  const m = (mode === "fun" ? "fun" : "trivia");
  const b = window.bucket10(bucket);
  return `${m}_${b}`;
}

async function warmPublicCache(mode, bucket){
  const k = keyMB(mode, bucket);
  if (publicCache.has(k)) return;

  try{
    const items = await fetchPublicMetaphors({
      mode: (mode === "fun" ? "fun" : "trivia"),
      bucket: window.bucket10(bucket),
      limit: 200
    });
    publicCache.set(k, items);
  }catch{
    publicCache.set(k, []);
  }
}

function getPublicItems(mode, bucket){
  const k = keyMB(mode, bucket);

  if (!publicCache.has(k)) {
    warmPublicCache(mode, bucket).then(() => scheduleRender()).catch(() => {});
    return [];
  }

  const arr = publicCache.get(k) || [];
  return arr.map(it => ({
    text: it.text,
    source: "public",
    id: it.id,
    penName: it.penName || null,
    totalLikes: Number(it.totalLikes || 0),
    hof: !!it.hof
  }));
}

// =========================
// 天気取得：Open-Meteo
// =========================
window.bucket10 = window.bucket10 || function (p) {
  p = Math.max(0, Math.min(100, Number(p)));
  const b = Math.round(p / 10) * 10;
  return Math.max(0, Math.min(100, b));
};

const GEO = "https://geocoding-api.open-meteo.com/v1/search";
const FC  = "https://api.open-meteo.com/v1/forecast";

// ✅ SWRキャッシュ
const WX_CACHE_KEY = "wx_pops_cache_v1";
const WX_CACHE_TTL_MS = 10 * 60 * 1000;

function wxKey(lat, lon){
  const la = Math.round(Number(lat) * 100) / 100;
  const lo = Math.round(Number(lon) * 100) / 100;
  return `${la},${lo}`;
}
function loadWxCache(){
  try { return JSON.parse(localStorage.getItem(WX_CACHE_KEY) || "{}"); }
  catch { return {}; }
}
function saveWxCache(obj){
  try { localStorage.setItem(WX_CACHE_KEY, JSON.stringify(obj)); } catch {}
}
async function fetchWithTimeout(url, ms = 4500){
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try{
    return await fetch(url, { cache: "no-store", signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

let __freezeMetaphor = false;
window.__forceRepick = false;

// =========================
// state
// =========================
let state = {
  pops: null,
  placeLabel: null,
  tz: null,
  source: "API: 未接続",
  hofThreshold: 20,
  selectedLat: null,
  selectedLon: null,
  currentPhrases: {
    m: { text: null, source: null, id: null, penName: null, likesToday: 0, totalLikes: 0, hof: false, mode: null, bucket: null },
    d: { text: null, source: null, id: null, penName: null, likesToday: 0, totalLikes: 0, hof: false, mode: null, bucket: null },
    e: { text: null, source: null, id: null, penName: null, likesToday: 0, totalLikes: 0, hof: false, mode: null, bucket: null }
  }
};

// ✅ 全ネタ一意ID（base/jsonも集計対象）
function fnv1a32(str){
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
function makeGlobalId({mode, bucket, text, source}){
  const m = (mode === "fun" ? "fun" : "trivia");
  const t = String(text || "").trim();
  return `t_${m}_${fnv1a32(`${m}|${t}`)}`;
}

// アイコン
function iconForPop(roundedPop) {
  const p = Number(roundedPop);
  if (p <= 20) return "☀️";
  if (p <= 60) return "⛅";
  return "🌧️";
}
function setIcon(slotKey, roundedPop) {
  const el = document.getElementById(`wx_${slotKey}`);
  if (!el) return;
  if (roundedPop == null) { el.textContent = "--"; return; }
  el.textContent = iconForPop(roundedPop);
}

// theme
function applyTheme(rounded){
  try{
    const body = document.body;
    if (!body) return;
    body.classList.remove("theme-sunny", "theme-cloudy", "theme-rainy");
    if (rounded == null) return;

    const p = Number(rounded);
    if (p <= 20) body.classList.add("theme-sunny");
    else if (p <= 60) body.classList.add("theme-cloudy");
    else body.classList.add("theme-rainy");
  }catch(e){
    console.warn("applyTheme error", e);
  }
}

// =========================
// ✅ いいねUI DOM補完
// =========================
function ensureLikeDom(slot){
  const btn = document.getElementById(`like_${slot}`);
  let count = document.getElementById(`likeCount_${slot}`);
  let badge = document.getElementById(`badge_${slot}`);

  if (!btn) return;

  btn.classList.add("like-btn-pop");

  if (!count) {
    const span = document.createElement("span");
    span.id = `likeCount_${slot}`;
    span.textContent = "0";
    span.style.fontWeight = "900";
    span.style.marginLeft = "6px";

    btn.textContent = "👍";
    btn.appendChild(span);
    count = span;
  }

  const totalId = `likeTotal_${slot}`;
  let total = document.getElementById(totalId);
  if (!total) {
    total = document.createElement("span");
    total.id = totalId;
    total.className = "muted";
    total.textContent = "累計👍0";
    total.style.marginLeft = "10px";
    btn.insertAdjacentElement("afterend", total);
  }

  if (!badge) {
    const wrap = btn.parentElement;
    if (wrap) {
      const b = document.createElement("span");
      b.id = `badge_${slot}`;
      b.style.marginLeft = "6px";
      wrap.appendChild(b);
    }
  }
}

function getSelectedMode() {
  const el = document.querySelector('input[name="mode"]:checked');
  const v = (el ? String(el.value || "").trim() : "");
  if (v === "fun" || v === "お笑い") return "fun";
  if (v === "trivia" || v === "雑学") return "trivia";
  return "trivia";
}

function getBaseTexts(mode, bucket) {
  bucket = Number(bucket);
  const base = (mode === "trivia"
    ? (window.NETA_TRIVIA?.[bucket] ?? [])
    : (window.NETA?.[bucket] ?? []));
  return base
    .map(x => String(x || "").trim())
    .filter(Boolean)
    .filter(t => !isNgText(t));
}

function buildCandidatePool(mode, bucket) {
  const b = window.bucket10(bucket);
  const m = (mode === "fun" ? "fun" : "trivia");

  const baseItems = getBaseTexts(m, b).map(text => ({
    text,
    source: "base",
    id: makeGlobalId({ mode: m, bucket: b, text, source: "base" }),
    penName: null,
    totalLikes: 0,
    hof: false
  }));

  const jsonItems = getSharedItems(m, b).map(x => ({
    text: x.text,
    source: "json",
    id: makeGlobalId({ mode: m, bucket: b, text: x.text, source: "json" }),
    penName: null,
    totalLikes: 0,
    hof: false
  }));

  const publicItems = getPublicItems(m, b);
  const merged = [...publicItems, ...jsonItems, ...baseItems];

  const out = [];
  const seen = new Set();
  for (const item of merged) {
    const t = String(item?.text || "").trim();
    if (!t) continue;
    if (isNgText(t)) continue;
    if (hasHard100PercentMismatch(t, b)) continue;
    if (hasMismatchedPercent(t, b)) continue;
    if (seen.has(t)) continue;
    seen.add(t);

    out.push({
      text: t,
      source: item.source || "base",
      id: item.id || makeGlobalId({ mode: m, bucket: b, text: t, source: item.source || "base" }),
      penName: item.penName || null,
      totalLikes: Number(item.totalLikes || 0),
      hof: !!item.hof,
      bucket: b,
      mode: m
    });
  }
  return out;
}

const lastPickKey = {};
function pickMetaphor(mode, bucket) {
  const b = window.bucket10(bucket);
  const pool = buildCandidatePool(mode, b);

  if (!pool.length) return { text: "データなし", source: null, id: null, penName: null, totalLikes: 0, hof: false, bucket: b, mode };

  const key = `${mode}_${b}`;
  let picked = pool[Math.floor(Math.random() * pool.length)];

  if (pool.length > 1) {
    let attempts = 0;
    while (picked.text === lastPickKey[key] && attempts < 6) {
      picked = pool[Math.floor(Math.random() * pool.length)];
      attempts++;
    }
  }
  lastPickKey[key] = picked.text;
  return picked;
}

function getCurrentMainBucket(){
  if (!state?.pops) return null;
  const arr = [state.pops.m, state.pops.d, state.pops.e].filter(v => v != null);
  if (!arr.length) return null;
  return window.bucket10(Math.max(...arr));
}

// =========================
// ✅ いいねUI（public/base/jsonすべてOK）
// =========================
function updateLikeUI(slot) {
  ensureLikeDom(slot);

  const phraseObj = state.currentPhrases[slot];
  const btnEl = document.getElementById(`like_${slot}`);
  const countEl = document.getElementById(`likeCount_${slot}`);
  const totalEl = document.getElementById(`likeTotal_${slot}`);
  const badgeEl = document.getElementById(`badge_${slot}`);

  if (!btnEl) return;

  const ok = !!phraseObj?.id && !!phraseObj?.text && !isNgText(phraseObj.text);
  btnEl.style.display = ok ? "" : "none";
  if (totalEl) totalEl.style.display = ok ? "" : "none";
  if (badgeEl) badgeEl.style.display = ok ? "" : "none";

  if (!ok) {
    if (countEl) countEl.textContent = "0";
    if (totalEl) totalEl.textContent = "累計👍0";
    if (badgeEl) { badgeEl.textContent = ""; badgeEl.style.display = "none"; }
    btnEl.onclick = null;
    return;
  }

  const likesToday = Number(phraseObj.likesToday || 0);
  const totalLikes = Number(phraseObj.totalLikes || 0);
  const hof = !!phraseObj.hof || (totalLikes >= Number(state.hofThreshold || 20));

  if (countEl) countEl.textContent = String(likesToday);
  if (totalEl) totalEl.textContent = `累計👍${totalLikes}`;

  if (badgeEl) {
    if (hof) {
      badgeEl.innerHTML = `👑<span class="hof-badge">殿堂入り</span>`;
      badgeEl.style.display = "";
    } else if (likesToday >= 5) {
      badgeEl.textContent = "⭐候補！";
      badgeEl.style.display = "";
    } else {
      badgeEl.textContent = "";
      badgeEl.style.display = "none";
    }
  }

  btnEl.disabled = false;
  btnEl.onclick = async () => {
    btnEl.disabled = true;
    try{
      const out = await likeAny({
        id: phraseObj.id,
        mode: phraseObj.mode || getSelectedMode(),
        bucket: Number(phraseObj.bucket ?? 0),
        text: phraseObj.text,
        penName: normalizePenName(phraseObj.penName),
        source: phraseObj.source || null,
        clientId: getClientId(),
      });

      likeFxPop(btnEl);
      likeFxPlusOne(btnEl);

      state.currentPhrases[slot].likesToday = Number(out.likesToday || 0);
      state.currentPhrases[slot].totalLikes = Number(out.totalLikes || state.currentPhrases[slot].totalLikes || 0);
      state.currentPhrases[slot].hof = !!out.hof || (state.currentPhrases[slot].totalLikes >= Number(state.hofThreshold || 20));

      updateLikeUI(slot);
    }catch(e){
      alert(`いいね失敗：${e?.message || e}`);
    }finally{
      btnEl.disabled = false;
    }
  };
}

function updateDeleteUI(slotKey) {
  const btn = document.getElementById(`del_${slotKey}`);
  if (!btn) return;
  btn.style.display = "none";
  btn.onclick = null;
}

// =========================
// renderEmpty
// =========================
function renderEmpty() {
  const metaAll = document.getElementById("metaphor");

  ["m","d","e"].forEach(k => {
    const popEl = document.getElementById(`pop_${k}`);
    const metaEl = document.getElementById(`meta_${k}`);

    if (popEl) popEl.textContent = "--%";
    if (metaEl) metaEl.textContent = "データなし";
    setIcon(k, null);

    state.currentPhrases[k] = {
      text: null, source: null, id: null, penName: null,
      likesToday: 0, totalLikes: 0, hof: false, mode: null, bucket: null
    };
    updateLikeUI(k);
    updateDeleteUI(k);
  });

  if (metaAll) metaAll.textContent = "地点を選んでください";
}

// =========================
// render（メイン）
// =========================
// =========================
// render（メイン）
// =========================
function render() {
  const hintEl = document.getElementById("popHint");
  const sourceTag = document.getElementById("sourceTag");
  const tzTag = document.getElementById("tzTag");
  const metaAll = document.getElementById("metaphor");
  const footEl = document.getElementById("metaFoot");

  if (sourceTag) sourceTag.textContent = state.source;
  if (tzTag) tzTag.textContent = state.tz ? `TZ: ${state.tz}` : "TZ: --";

  const setSlot = (slotKey, value, label) => {
    const popEl = document.getElementById(`pop_${slotKey}`);
    const metaEl = document.getElementById(`meta_${slotKey}`);

    if (value == null) {
      if (popEl) popEl.textContent = "--%";
      if (metaEl) metaEl.textContent = "データなし";
      setIcon(slotKey, null);

      state.currentPhrases[slotKey] = {
        text: null, source: null, id: null, penName: null,
        likesToday: 0, totalLikes: 0, hof: false, mode: null, bucket: null
      };
      updateLikeUI(slotKey);
      updateDeleteUI(slotKey);
      return null;
    }

    const rounded = window.bucket10(value);
    if (popEl) popEl.textContent = `${rounded}%`;
    setIcon(slotKey, rounded);

    const mode = getSelectedMode();
    let picked;

    const prev = state.currentPhrases[slotKey] || {};
    const sameContext =
      !!prev.text &&
      prev.mode === mode &&
      Number(prev.bucket) === Number(rounded) &&
      !isNgText(prev.text);

    if (!window.__forceRepick && sameContext) {
      picked = prev;
    } else if (__freezeMetaphor && prev?.text) {
      picked = prev;
    } else {
      picked = pickMetaphor(mode, rounded);
    }

    // NGを避けて再抽選
    for (let i = 0; i < 5 && picked?.text && isNgText(picked.text); i++) {
      picked = pickMetaphor(mode, rounded);
    }

    // ✅ NGだった場合の最終ガード
    if (picked?.text && isNgText(picked.text)) {
      picked = {
        text: "（非表示ワードが含まれるため表示できません）",
        source: null,
        id: null,
        penName: null,
        totalLikes: 0,
        hof: false,
        bucket: rounded,
        mode
      };
    }

    // ✅ publicCache が後から温まった場合でも、
    //    同一テキストが public にあれば「累計/ID/ペンネーム」を public に寄せて更新する
    //    ※テキスト自体は変えない（チカチカ防止）
    try {
      const mbKey = keyMB(mode, rounded);
      const pubArr = publicCache.get(mbKey);

      if (Array.isArray(pubArr) && pubArr.length && picked?.text) {
        const t = String(picked.text).trim();
        const hit = pubArr.find(it => String(it?.text || "").trim() === t);

        if (hit) {
          picked = {
            ...picked,
            source: "public",
            id: String(hit.id || picked.id || "").trim() || null,
            penName: (hit.penName != null ? String(hit.penName).trim() : picked.penName),
            totalLikes: Number(hit.totalLikes || 0),
            hof: !!hit.hof
          };
        }
      }
    } catch (e) {
      console.warn("public upgrade failed", e);
    }

    const displayPen = (picked.penName && String(picked.penName).trim())
      ? String(picked.penName).trim()
      : "匿名";

    const totalLikesPicked = Number(picked.totalLikes || 0);
    const hofPicked = !!picked.hof || (totalLikesPicked >= Number(state.hofThreshold || 20));

    if (metaEl) {
      const penHtml = penHtmlIfAny(displayPen);
      const hofHtml = hofPicked ? ` <span class="hof-badge">👑殿堂入り</span>` : "";
      metaEl.innerHTML =
        `${escapeHtml(label)}：${escapeHtml(picked.text)}${penHtml}${hofHtml}` +
        ` <span class="muted" style="font-size:12px;">[src:${escapeHtml(picked.source || "base")} b:${rounded}]</span>`;
    }

    const prevId = state.currentPhrases[slotKey]?.id || null;
    const nextId = picked.id || null;

    const nextLikesToday = (prevId && nextId && prevId === nextId)
      ? Number(state.currentPhrases[slotKey]?.likesToday || 0)
      : 0;

    const nextTotalLikes = (prevId && nextId && prevId === nextId)
      ? Number(state.currentPhrases[slotKey]?.totalLikes || totalLikesPicked || 0)
      : Number(totalLikesPicked || 0);

    state.currentPhrases[slotKey] = {
      text: picked.text,
      source: picked.source || null,
      id: nextId,
      penName: displayPen,
      likesToday: nextLikesToday,
      totalLikes: nextTotalLikes,
      hof: hofPicked,
      mode,
      bucket: rounded
    };

    updateLikeUI(slotKey);
    updateDeleteUI(slotKey);

    try { applyTheme(rounded); } catch {}

    return { slotKey, value: rounded, text: picked.text, label };
  };

  if (!state.pops) {
    if (hintEl) hintEl.textContent = "地点を選ぶと自動取得します";
    renderEmpty();
    if (footEl) footEl.textContent = "";
    try { ensureMySubmissionsDom(); } catch {}
    try { renderMySubmissions(); } catch (e) { console.warn("renderMySubmissions error", e); }
    return;
  }

  if (hintEl) hintEl.textContent = state.placeLabel ? `地点：${state.placeLabel}` : "地点：--";

  const a = setSlot("m", state.pops.m, "朝");
  const b = setSlot("d", state.pops.d, "昼");
  const c = setSlot("e", state.pops.e, "夜");

  const candidates = [a, b, c].filter(Boolean);
  if (!candidates.length) {
    if (metaAll) metaAll.textContent = "データが取得できませんでした（別地点で試してください）";
    if (footEl) footEl.textContent = "";
    return;
  }

  const maxOne = candidates.reduce((x, y) => (y.value > x.value ? y : x));
  if (metaAll) {
    const p = state.currentPhrases?.[maxOne.slotKey] || {};
    const src = p.source || "base";
    const bkt = Number(p.bucket ?? maxOne.value);

    metaAll.innerHTML =
      `今日いちばん怪しいのは【${escapeHtml(maxOne.label)}】：${escapeHtml(String(maxOne.value))}% → ${escapeHtml(String(maxOne.text))}` +
      ` <span class="muted" style="font-size:12px;">[src:${escapeHtml(src)} b:${escapeHtml(String(bkt))}]</span>`;
  }

  if (footEl) {
    footEl.textContent = "※降水確率を0/10/…/100%に丸め、公開ネタ（public/base/json）からランダム表示";
  }
}
// =========================
// API: geocode
// =========================
async function geocode(name) {
  const url = new URL(GEO);
  url.searchParams.set("name", name);
  url.searchParams.set("count", "10");
  url.searchParams.set("language", "ja");
  url.searchParams.set("format", "json");
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error("地点検索に失敗しました");
  return await res.json();
}

// ✅（内部）天気取得本体
async function fetchPopsBySlotsNetwork(lat, lon, timeoutMs = 4500) {
  const url = new URL(FC);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("hourly", "precipitation_probability");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "2");

  const res = await fetchWithTimeout(url.toString(), timeoutMs);
  if (!res.ok) throw new Error("天気取得に失敗しました");
  const data = await res.json();

  const times = data.hourly?.time || [];
  const pops  = data.hourly?.precipitation_probability || [];
  const tz    = data.timezone || null;

  const today = (times[0] || "").slice(0, 10);
  const bucket = { m: [], d: [], e: [] };

  for (let i = 0; i < Math.min(times.length, pops.length); i++) {
    const t = times[i];
    const p = pops[i];
    if (typeof p !== "number") continue;
    if (!t || t.slice(0, 10) !== today) continue;

    const hour = Number(t.slice(11, 13));
    if (hour >= 6 && hour <= 11) bucket.m.push(p);
    else if (hour >= 12 && hour <= 17) bucket.d.push(p);
    else if (hour >= 18 && hour <= 23) bucket.e.push(p);
  }

  const maxOrNull = (arr) => arr.length ? Math.round(Math.max(...arr)) : null;

  return {
    pops: { m: maxOrNull(bucket.m), d: maxOrNull(bucket.d), e: maxOrNull(bucket.e) },
    tz
  };
}

// ✅（表）SWR（キャッシュ即表示→裏で更新）
async function fetchPopsBySlotsSWR(lat, lon, { onCached, timeoutMs = 4500 } = {}) {
  const key = wxKey(lat, lon);
  const cache = loadWxCache();
  const hit = cache?.[key];

  const now = Date.now();
  const isFresh = hit && hit.ts && (now - hit.ts) < WX_CACHE_TTL_MS;

  if (hit?.pops && typeof onCached === "function") {
    onCached({ pops: hit.pops, tz: hit.tz || null, cached: true, fresh: !!isFresh });
  }

  const out = await fetchPopsBySlotsNetwork(lat, lon, timeoutMs);
  cache[key] = { ts: Date.now(), pops: out.pops, tz: out.tz || null };
  saveWxCache(cache);

  return out;
}

// =========================
// ✅ ランキングDOM
// =========================
function ensureRankingDom(){
  if (document.getElementById("todayRankingWrap")) return;

  const refreshBtn = document.getElementById("refresh");
  if (!refreshBtn) return;

  const wrap = document.createElement("div");
  wrap.id = "todayRankingWrap";
  wrap.style.marginTop = "14px";

  refreshBtn.insertAdjacentElement("afterend", wrap);
}

// =========================
// ✅ 最新枠（折り畳み）の開閉状態を保存
// =========================
const LATEST_OPEN_KEY = "latest_open_v1";
function loadLatestOpen(){
  try { return localStorage.getItem(LATEST_OPEN_KEY) === "1"; } catch { return false; }
}
function saveLatestOpen(open){
  try { localStorage.setItem(LATEST_OPEN_KEY, open ? "1" : "0"); } catch {}
}

// =========================
// ✅ ランキング固定（検索成功 or モード変更 のときだけ更新）
// =========================
let __rankingRenderedKey = null;

function makeRankingKey({ mode, bucket, lat, lon }){
  const mv = String(mode || "").trim();
  const m = (mv === "fun" || mv === "お笑い") ? "fun" : "trivia";
  const b = (bucket == null) ? "null" : String(window.bucket10(bucket));
  const la = (lat == null) ? "null" : String(Math.round(Number(lat) * 10000) / 10000);
  const lo = (lon == null) ? "null" : String(Math.round(Number(lon) * 10000) / 10000);
  return `${m}|${b}|${la},${lo}`;
}

function invalidateRanking(){
  __rankingRenderedKey = null;
}

function getRankingKeyNow(){
  const mode = getSelectedMode();
  const bucket = getCurrentMainBucket();
  const lat = state.selectedLat;
  const lon = state.selectedLon;
  if (bucket == null || lat == null || lon == null) return null;
  return makeRankingKey({ mode, bucket, lat, lon });
}

async function renderRankingOnce(key){
  if (!key) return;
  if (__rankingRenderedKey === key) return;
  __rankingRenderedKey = key;
  await renderRanking();
}

// =========================
// ランキング表示（中身）
// ✅ 表示は「最新（折り畳み）＋今日の総合TOP3＋殿堂入り」だけ
// =========================
async function renderRanking(){
  try{
    ensureRankingDom();
    const wrap = document.getElementById("todayRankingWrap");
    if (!wrap) return;

    const mode = getSelectedMode();
    const hofTh = Number(state.hofThreshold || 20);
    const latestOpen = loadLatestOpen();

    wrap.innerHTML = `
      <div class="card" style="margin:0 0 10px 0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
        <details class="latest-details" id="latestDetails" ${latestOpen ? "open" : ""} style="margin:0;">
          <summary style="display:flex; align-items:center; justify-content:space-between;">
            <span>最新の公開ネタ（折り畳み） / ${mode==="fun"?"お笑い":"雑学"}</span>
            <span class="muted" style="font-size:12px;">（開くと10件）</span>
          </summary>
          <div class="muted" style="margin-top:10px;" id="latestBody">読み込み中…</div>
        </details>
      </div>

      <div class="card" style="margin:0 0 10px 0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
        <div style="font-weight:900; font-size:16px; margin-bottom:6px;">今日のランキング TOP3（全バケット共通 / ${mode==="fun"?"お笑い":"雑学"}）</div>
        <div class="muted" style="margin-bottom:8px;">※今日(JST)のいいね数で集計（0〜100%まとめて）</div>
        <div class="muted" id="rankingBodyTodayAll">読み込み中…</div>
      </div>

      <div class="card" style="margin:0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
        <div style="font-weight:900; font-size:16px; margin-bottom:6px;">殿堂入り（全モード共通 / 累計👍${hofTh}以上）</div>
        <div class="muted" style="margin-bottom:8px;">※殿堂入りは累計が閾値を超えると自動で表示</div>
        <div class="muted" id="rankingBodyHof">読み込み中…</div>
      </div>
    `;

    // ✅ 開閉状態保存
    try{
      const det = document.getElementById("latestDetails");
      if (det && !det.dataset.wired){
        det.dataset.wired = "1";
        det.addEventListener("toggle", () => {
          saveLatestOpen(!!det.open);
        });
      }
    }catch{}

    const latestBody  = document.getElementById("latestBody");
    const bodyTodayAll = document.getElementById("rankingBodyTodayAll");
    const bodyHof      = document.getElementById("rankingBodyHof");

    // ---- 最新（折り畳み）----
    try{
      const items = (await fetchPublicLatest(mode, 10))
        .filter(it => !isNgText(it?.text));

      if (!items.length) {
        if (latestBody) latestBody.textContent = "最新の公開ネタがまだありません";
      } else {
        const rows = items.map((it, idx) => {
          const pen = penHtmlIfAny(it.penName);
          const bkt = Number(it.bucket ?? 0);
          const bktTag = Number.isFinite(bkt) ? ` <span class="muted" style="font-size:12px;">[${bkt}%]</span>` : "";
          return `
            <div style="padding:10px 0; border-top:1px solid rgba(15,23,42,0.10);">
              <div style="font-weight:800;">${idx+1}. ${escapeHtml(it.text)}${pen}${bktTag}</div>
            </div>
          `;
        }).join("");
        if (latestBody) latestBody.innerHTML = rows;
      }
    } catch (e) {
      if (latestBody) latestBody.textContent = `最新の取得に失敗：${e?.message || e}`;
    }

    // ---- 今日TOP3（全バケット共通） ----
    try{
      const items = (await fetchRankingTodayAll(mode, 3))
        .filter(it => !isNgText(it?.text));

      if (!items.length) {
        if (bodyTodayAll) bodyTodayAll.textContent = "まだランキングがありません（今日の👍が0件）";
      } else {
        const rows = items.map((it, idx) => {
          const pen = penHtmlIfAny(it.penName);
          return `
            <div style="padding:10px 0; border-top:1px solid rgba(15,23,42,0.10);">
              <div style="font-weight:800;">${idx+1}位：${escapeHtml(it.text)}${pen}${modeBadgeHtml(mode)}</div>
              <div class="muted">今日の👍：${Number(it.likes||0)}</div>
            </div>
          `;
        }).join("");
        if (bodyTodayAll) bodyTodayAll.innerHTML = rows;
      }
    } catch (e) {
      if (bodyTodayAll) bodyTodayAll.textContent = `総合ランキング取得に失敗：${e?.message || e}`;
    }

    // ---- 殿堂入り（全モード共通：trivia+fun を合体）----
    try{
      const [tItems, fItems] = await Promise.all([
        fetchHallOfFame("trivia", 0, 200),
        fetchHallOfFame("fun",    0, 200),
      ]);

      const merged = [...tItems, ...fItems]
        const tTagged = tItems.map(it => ({ ...it, __mode: "trivia" }));
        const fTagged = fItems.map(it => ({ ...it, __mode: "fun" }));
        const merged = [...tTagged, ...fTagged]
        .filter(it => !isNgText(it?.text))
        .reduce((acc, it) => {
          const id = String(it?.id || "");
          if (!id) return acc;
          if (!acc.map.has(id)) { acc.map.set(id, it); acc.arr.push(it); }
          return acc;
        }, { map:new Map(), arr:[] }).arr
        .sort((a,b) => Number(b.totalLikes||0) - Number(a.totalLikes||0));

      const hofTh2 = Number(state.hofThreshold || 20);

      if (!merged.length) {
        if (bodyHof) bodyHof.textContent = `まだ殿堂入りがありません（累計👍${hofTh2}以上が0件）`;
      } else {
        const rows = merged.slice(0, 20).map((it, idx) => {
          const pen = penHtmlIfAny(it.penName);
          const totalLikes = Number(it.totalLikes || 0);
          return `
            <div style="padding:10px 0; border-top:1px solid rgba(15,23,42,0.10);">
              <div style="font-weight:800;">${idx+1}. ${escapeHtml(it.text)}${pen}${modeBadgeHtml(it.__mode)} <span class="hof-badge">👑殿堂入り</span></div>
              <div class="muted">累計👍：${totalLikes}</div>
            </div>
          `;
        }).join("");

        const more = (merged.length > 20)
          ? `<div class="muted" style="margin-top:8px;">※表示は上位10件まで（全${merged.length}件）</div>`
          : "";

        if (bodyHof) bodyHof.innerHTML = rows + more;
      }
    } catch (e) {
      if (bodyHof) bodyHof.textContent = `殿堂入り取得に失敗：${e?.message || e}`;
    }

  } catch(e){
    console.warn("renderRanking error", e);
  }
}

// =========================
// ✅ 承認フラグがあれば次の検索成功で花火
// =========================
function fireIfApprovedOnNextSearch(){
  try{
    const raw = localStorage.getItem("fw_on_next_search");
    if (!raw) return;

    const obj = JSON.parse(raw || "{}");
    const ts = Number(obj.ts || 0);
    if (!ts) { localStorage.removeItem("fw_on_next_search"); return; }

    const TTL = 24 * 60 * 60 * 1000;
    if (Date.now() - ts > TTL) {
      localStorage.removeItem("fw_on_next_search");
      return;
    }

    localStorage.removeItem("fw_on_next_search");
    fireworksOnce();
  }catch(e){
    console.warn("fireIfApprovedOnNextSearch error", e);
  }
}

// =========================
// UI: 検索→候補表示
// =========================
(function wireSearch(){
  const btn = document.getElementById("search");
  if (!btn) return;

  btn.onclick = async () => {
    const raw = document.getElementById("place").value.trim();
    const q = normalizePlaceName(raw);

    const sel = document.getElementById("candidates");
    sel.innerHTML = "";
    sel.disabled = true;

    if (!q) { setStatus("地点名を入力してください", "ng"); return; }

    setStatus("検索中…", "muted");

    try {
      let g = await geocode(q);
      let results = g.results || [];

      if (!results.length && raw !== q) {
        g = await geocode(raw);
        results = g.results || [];
      }

      if (!results.length) {
        setStatus("候補が見つかりませんでした。別の書き方で試してください。（例：Sendai）", "ng");
        return;
      }

      results.forEach((r, idx) => {
        const labelParts = [r.name, r.admin1, r.country].filter(Boolean);
        const label = labelParts.join(" / ");
        const opt = document.createElement("option");
        opt.value = String(idx);
        opt.textContent = label;
        opt.dataset.lat = r.latitude;
        opt.dataset.lon = r.longitude;
        sel.appendChild(opt);
      });

      sel.disabled = false;
      setStatus("候補を選ぶと天気を取得します", "ok");

      sel.onchange = async () => {
        const opt = sel.options[sel.selectedIndex];
        const lat = Number(opt.dataset.lat);
        const lon = Number(opt.dataset.lon);

        state.selectedLat = lat;
        state.selectedLon = lon;

        window.__forceRepick = true;
        setTimeout(() => { window.__forceRepick = false; }, 0);

        state.placeLabel = opt.textContent;
        state.source = "API: Open-Meteo";

        scheduleRender();
        setStatus("天気取得中…", "muted");

        let usedCache = false;

        try {
          const out = await fetchPopsBySlotsSWR(lat, lon, {
            onCached: (cached) => {
              if (!cached?.pops) return;
              usedCache = true;
              state.pops = cached.pops;
              state.tz = cached.tz || null;
              scheduleRender();
              setStatus("キャッシュ表示中…（裏で最新取得）", "muted");

              try{
                Promise.all([
                  warmPublicCache(getSelectedMode(), cached.pops?.m ?? 0),
                  warmPublicCache(getSelectedMode(), cached.pops?.d ?? 0),
                  warmPublicCache(getSelectedMode(), cached.pops?.e ?? 0),
                ]).then(() => scheduleRender()).catch(() => {});
              }catch{}
            }
          });

          state.pops = out.pops;
          state.tz = out.tz;

          try{
            Promise.all([
              warmPublicCache(getSelectedMode(), state.pops?.m ?? 0),
              warmPublicCache(getSelectedMode(), state.pops?.d ?? 0),
              warmPublicCache(getSelectedMode(), state.pops?.e ?? 0),
            ]).then(() => scheduleRender()).catch(() => {});
          }catch{}

          const any = (state.pops.m != null) || (state.pops.d != null) || (state.pops.e != null);
          if (!any) {
            setStatus("降水確率が取得できませんでした（別地点で試してください）", "ng");
            state.source = "API: 取得失敗";
            state.pops = null;
          } else {
            setStatus("取得しました", "ok");

            try{ pingUsageOncePerDay("wx_ok"); }catch{}
            try { fireIfApprovedOnNextSearch(); } catch {}

            try{
              const key = getRankingKeyNow();
              await renderRankingOnce(key);
            }catch(e){
              console.warn("renderRankingOnce(after search) failed", e);
            }
          }

          scheduleRender();
        } catch (e) {
          if (usedCache) {
            setStatus(`最新の取得に失敗（キャッシュ表示中）：${e?.message || e}`, "ng");
            state.source = "API: 更新失敗";
            scheduleRender();
            return;
          }

          setStatus(e.message || "天気取得エラー", "ng");
          state.source = "API: エラー";
          state.pops = null;
          scheduleRender();
        }
      };

      sel.selectedIndex = 0;
      sel.onchange();

    } catch (e) {
      setStatus(e.message || "検索エラー", "ng");
    }
  };
})();

// =========================
// mode 切替（ランキング更新）
// =========================
document.querySelectorAll('input[name="mode"]').forEach(r =>
  r.addEventListener("change", async () => {
    __freezeMetaphor = false;
    scheduleRender();

    invalidateRanking();

    if (state?.pops) {
      try{
        Promise.all([
          warmPublicCache(getSelectedMode(), state.pops?.m ?? 0),
          warmPublicCache(getSelectedMode(), state.pops?.d ?? 0),
          warmPublicCache(getSelectedMode(), state.pops?.e ?? 0),
        ]).then(() => scheduleRender()).catch(() => {});
      }catch{}

      try{
        const key = getRankingKeyNow();
        await renderRankingOnce(key);
      }catch(e){
        console.warn("renderRankingOnce(on mode change) failed", e);
      }
    } else {
      // 地点未選択でも最新/ランキングだけは見たい場合 → ここは何もしない（固定仕様）
    }
  })
);

(function wireRefresh(){
  const btn = document.getElementById("refresh");
  if (!btn) return;

  btn.onclick = () => {
    window.__forceRepick = true;
    __freezeMetaphor = false;

    scheduleRender();
    requestAnimationFrame(() => {
      window.__forceRepick = false;
    });
  };
})();

// ==============================
// ✅ 自分の投稿欄DOM（HTML改修不要）
// ==============================
function ensureMySubmissionsDom(){
  if (document.getElementById("mySubmissionsWrap")) return true;

  const wrap = document.createElement("div");
  wrap.id = "mySubmissionsWrap";
  wrap.className = "card";
  wrap.style.marginTop = "12px";
  wrap.style.maxWidth = "760px";
  wrap.style.marginLeft = "auto";
  wrap.style.marginRight = "auto";

  wrap.innerHTML = `
    <div style="font-weight:900;">あなたの投稿</div>
    <div class="muted" style="margin-top:6px;font-size:12px;">
      この端末から投稿した分だけ表示（他人には見えません）
    </div>
    <div id="my-submissions-list" style="margin-top:10px;"></div>
  `;

  document.body.appendChild(wrap);
  return true;
}

// =========================
// 🎆 Fireworks (no library)
// =========================
let __fwCanvas = null;
let __fwCtx = null;
let __fwRAF = 0;
let __fwActive = false;
let __fwParticles = [];
let __fwStartAt = 0;
let __fwDuration = 5000;

function ensureFireworksCanvas(){
  if (__fwCanvas) return;

  __fwCanvas = document.createElement("canvas");
  __fwCanvas.id = "fireworksCanvas";
  __fwCanvas.style.position = "fixed";
  __fwCanvas.style.left = "0";
  __fwCanvas.style.top = "0";
  __fwCanvas.style.width = "100%";
  __fwCanvas.style.height = "100%";
  __fwCanvas.style.pointerEvents = "none";
  __fwCanvas.style.zIndex = "2147483647";
  __fwCanvas.style.opacity = "0";
  __fwCanvas.style.willChange = "opacity, transform";
  document.body.appendChild(__fwCanvas);

  __fwCtx = __fwCanvas.getContext("2d", { alpha: true });
  if (!__fwCtx) {
    console.warn("fireworks: getContext failed");
    return;
  }

  const resize = () => {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    __fwCanvas.width  = Math.floor(window.innerWidth  * dpr);
    __fwCanvas.height = Math.floor(window.innerHeight * dpr);
    __fwCtx.setTransform(1, 0, 0, 1, 0, 0);
    __fwCtx.scale(dpr, dpr);
  };

  resize();
  window.addEventListener("resize", resize);
}

function rand(min, max){ return Math.random() * (max - min) + min; }

function spawnBurst(x, y){
  const count = Math.floor(rand(40, 70));
  for (let i=0; i<count; i++){
    const a = rand(0, Math.PI * 2);
    const sp = rand(2.0, 6.0);
    __fwParticles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: rand(40, 70),
      r: rand(1.2, 2.6),
      hue: rand(0, 360),
      alpha: 1
    });
  }
}

function fireworksOnce(){
  ensureFireworksCanvas();
  if (!__fwCtx || !__fwCanvas) return;

  const now = performance.now();

  if (__fwActive){
    __fwStartAt = now;
    __fwDuration = 8000;
    __fwCanvas.style.opacity = "1";
    return;
  }

  __fwActive = true;
  __fwStartAt = now;
  __fwDuration = 8000;
  __fwParticles = [];
  __fwCanvas.style.opacity = "1";

  const w = window.innerWidth;
  const h = window.innerHeight;

  spawnBurst(rand(w*0.2, w*0.8), rand(h*0.2, h*0.45));
  spawnBurst(rand(w*0.2, w*0.8), rand(h*0.2, h*0.45));

  const tick = () => {
    __fwRAF = requestAnimationFrame(tick);

    const t = performance.now();
    const elapsed = t - __fwStartAt;

    if (Math.random() < 0.16 && elapsed < __fwDuration){
      spawnBurst(rand(w*0.15, w*0.85), rand(h*0.18, h*0.5));
    }

    __fwCtx.globalCompositeOperation = "source-over";
    __fwCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    for (let i=__fwParticles.length-1; i>=0; i--){
      const p = __fwParticles[i];
      p.x += p.vx;
      p.y += p.vy;

      p.vx *= 0.98;
      p.vy = p.vy * 0.98 + 0.06;

      p.life -= 1;
      p.alpha *= 0.985;

      __fwCtx.beginPath();
      __fwCtx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      __fwCtx.fillStyle = `hsla(${p.hue}, 100%, 55%, ${Math.max(0, p.alpha)})`;
      __fwCtx.fill();

      if (p.life <= 0 || p.alpha <= 0.02){
        __fwParticles.splice(i, 1);
      }
    }

    if (elapsed > __fwDuration && __fwParticles.length === 0){
      stopFireworks();
    }
  };

  tick();
}

function stopFireworks(){
  if (!__fwActive) return;
  __fwActive = false;
  cancelAnimationFrame(__fwRAF);
  __fwRAF = 0;
  __fwParticles = [];
  if (__fwCtx) __fwCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  if (__fwCanvas) __fwCanvas.style.opacity = "0";
}

// ==============================
// ✅ ネタ追加（承認待ちへ送信）
// ==============================
function wireSubmit(){
  const btn = document.getElementById("submitPendingBtn");
  const ta  = document.getElementById("newPhrase");
  const modeSel = document.getElementById("newPhraseMode");
  const bucketSel = document.getElementById("newPhraseBucket");

  if (!btn || !ta) {
    console.warn("wireSubmit: submitPendingBtn/newPhrase not found");
    return;
  }

  if (btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";

  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();

    const mode = modeSel ? String(modeSel.value || "trivia") : getSelectedMode();
    const bucket = bucketSel ? Number(bucketSel.value) : (getCurrentMainBucket() ?? 0);

    const text = String(ta.value || "").trim();
    if (!text) { alert("ネタが空です"); return; }
    if (isNgText(text)) { alert("この文言は登録できません（非表示ワードを含みます）"); return; }

    const penEl = document.getElementById("penName");
    const pinEl = document.getElementById("penPin");

    const penName = penEl ? String(penEl.value || "").trim() : "";
    const penPin  = pinEl ? String(pinEl.value || "").trim() : "";

    if (penName && !penPin) {
      alert("ペンネームを使う場合は合言葉（PIN）が必要です。");
      return;
    }

    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = "送信中…";

    try{
      const clientId = makeGlobalId({ mode, bucket: window.bucket10(bucket), text, source: "local" });

      const out = await submitToPending(
        mode,
        window.bucket10(bucket),
        text,
        (penName || null),
        (penName ? penPin : null),
        clientId
      );

      const serverId = String(out?.id || "").trim();
      if (!serverId) {
        alert("送信は成功しましたが、サーバIDが取得できませんでした。");
        ta.value = "";
        return;
      }

      const my = {
        id: serverId,
        serverId: serverId,
        clientId: clientId,
        text: text,
        status: "pending",
        createdAt: Date.now(),
        mode: mode,
        bucket: window.bucket10(bucket)
      };

      saveMySubmission(my);

      ta.value = "";
      try{ ensureMySubmissionsDom(); }catch{}
      try{ renderMySubmissions(); }catch{}
      try{ await syncMySubmissionsStatus(); }catch{}

      alert("送信しました！（承認待ちに入りました）");
    }catch(e){
      alert(`送信失敗：${e?.message || e}`);
    }finally{
      btn.disabled = false;
      btn.textContent = oldText;
    }
  });
}

// ==============================
// ✅ 自分の投稿：承認状態同期
// ==============================
async function syncMySubmissionsStatus(){
  try{
    const key = "my_submissions";
    const list = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(list) || list.length === 0) return;

    const ids = Array.from(new Set(
      list.flatMap(x => {
        const a = String(x?.serverId || x?.id || "").trim();
        const b = String(x?.clientId || "").trim();
        return [a, b].filter(v => v && !v.startsWith("local_"));
      })
    )).slice(0, 50);

    if (ids.length === 0) return;

    const res = await fetch(`${API_BASE}/api/status?ids=${encodeURIComponent(ids.join(","))}`, { method:"GET", cache:"no-store" });
    const data = await res.json().catch(()=>null);

    if (!res.ok || !data?.ok) {
      console.warn("syncMySubmissionsStatus: bad response", res.status, data);
      return;
    }

    const items = Array.isArray(data?.items) ? data.items : [];
    const map = new Map(items.map(x => [String(x.id), x]));

    let becameApproved = 0;

    const next = list.map(x => {
      const serverId = String(x?.serverId || "").trim();
      const clientId = String(x?.clientId || "").trim();
      const id = String(x?.id || "").trim();

      const prev = String(x?.status || "pending");
      const st = map.get(serverId) || map.get(clientId) || map.get(id);
      if (!st) return x;

      const nowStatus =
        (st.status === "public")  ? "approved" :
        (st.status === "pending") ? "pending"  :
        (st.status === "missing") ? "missing"  :
        prev;

      if (prev !== "approved" && nowStatus === "approved") becameApproved++;

      return { ...x, status: nowStatus, approvedAt: st.approvedAt ?? x.approvedAt ?? null };
    });

    const cleaned = next.filter(x => {
      const st = String(x?.status || "");
      return (st !== "approved" && st !== "missing");
    });

    localStorage.setItem(key, JSON.stringify(cleaned));

    if (becameApproved > 0) {
      try {
        localStorage.setItem("fw_on_next_search", JSON.stringify({
          ts: Date.now(),
          count: becameApproved
        }));
      } catch {}
    }

    try{ renderMySubmissions(); }catch{}
  }catch(e){
    console.warn("syncMySubmissionsStatus error", e);
  }
}

// ==============================
// ✅ 自分の投稿：localStorage
// ==============================
function saveMySubmission(item){
  const key = "my_submissions";
  const list = JSON.parse(localStorage.getItem(key) || "[]");

  list.unshift(item);

  const MAX = 1000;
  if (list.length > MAX) list.length = MAX;

  localStorage.setItem(key, JSON.stringify(list));
}

// ==============================
// ✅ 自分の投稿表示
// ==============================
function renderMySubmissions(){
  const listEl = document.getElementById("my-submissions-list");
  if (!listEl) return;

  const list = JSON.parse(localStorage.getItem("my_submissions") || "[]");

  if (!list.length){
    listEl.innerHTML = `<div class="muted">まだ投稿はありません</div>`;
    return;
  }

  listEl.innerHTML = list
    .slice(0, 30)
    .map(item => {
      const id = String(item?.id || "");
      const st = String(item?.status || "pending");

      const isLocal = id.startsWith("local_");
      const isMissing = (st === "missing");

      const statusLabel =
        (st === "approved")
          ? `<span style="color:#16a34a;font-weight:900;">採用</span>`
          : (isLocal || isMissing)
            ? `<span style="color:#64748b;font-weight:900;">同期不可</span>`
            : `<span style="color:#f59e0b;font-weight:900;">承認中</span>`;

      const note =
        isLocal
          ? `<div class="muted" style="margin-top:4px;font-size:11px;">※この投稿は local_ のため承認状態を自動更新できません</div>`
          : isMissing
            ? `<div class="muted" style="margin-top:4px;font-size:11px;">※サーバ側にIDが見つかりません（/api/status=missing）。worker.js の保存キー/参照キーが一致しているか確認してください</div>`
            : "";

      return `
        <div style="
          border:1px solid rgba(15,23,42,.12);
          border-radius:12px;
          padding:10px;
          margin-bottom:8px;
          background:#fff;
        ">
          <div style="font-size:14px; white-space:pre-wrap;">${escapeHtml(String(item.text || ""))}</div>
          <div class="muted" style="margin-top:6px;font-size:12px;">
            状態：${statusLabel}
          </div>
          ${note}
        </div>
      `;
    })
    .join("");
}

// ==============================
// ✅ 初期化
// ==============================
async function init(){
  try { ensureRankingDom(); } catch {}
  try { ensureReindexHintDom(); } catch {}
  try { await loadSharedJSON(); } catch {}
  try { wireSubmit(); } catch (e) { console.warn(e); }

  try { ensureMySubmissionsDom(); } catch {}
  try { renderMySubmissions(); } catch {}
  try { await syncMySubmissionsStatus(); } catch {}
  try { setInterval(syncMySubmissionsStatus, 30000); } catch {}

  try { fixModeToggleAlignment(); } catch {}
  try { scheduleRender(); } catch {}

  // ✅ 起動直後にランキング枠を空でも描画（地点未選択でも最新枠は見たい場合）
  // ただし「固定キー仕様」と衝突しないよう、ここでは renderRanking は呼ばない（必要なら後で）
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

// =========================
// ✅ アプリを開くQR（トップ下）
// =========================
(function renderOpenAppQr(){
  const el = document.getElementById("openAppQr");
  if (!el || !window.QRCode) return;

  const url = "https://yyoshioka27-hash.github.io/tatoete-kousui/";

  el.innerHTML = "";
  new QRCode(el, {
    text: url,
    width: 150,
    height: 150,
    correctLevel: QRCode.CorrectLevel.M
  });
})();

// # END
