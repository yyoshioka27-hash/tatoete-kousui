// script.js  (FULL)
// ✅ FIX: 地域検索後にネタがチカチカ入れ替わる問題を抑制
// ✅ FIX: ランキングを古いレスポンスで上書きしない
// ✅ FIX: metaphors.js / public / json で同じネタが別表示・別カウントになる問題
// ✅ FIX: ランキングは検索成功時/モード切替時だけ更新
// ✅ SPEED: ランキングを段階表示（最新→今日→殿堂入り）に変更
// ✅ SPEED: 殿堂入り取得件数を 60 → 20 に縮小
// =========================

// =========================
// ✅ BUILD（反映確認用）
// =========================
const BUILD = "2026-04-03_hof_visible_latest_off_v1";
// =========================
// ✅ BUILD変更時に古いキャッシュを自動破棄
// =========================
async function clearOldAppCachesOnBuildChange() {
  const BUILD_KEY = "app_build_v1";
  const prev = localStorage.getItem(BUILD_KEY);

  if (prev === BUILD) return;

  try {
    const prefixes = [
      "hof_daily_cache_",
      "ranking_",
      "today_",
      "weather_",
      "publicLatest_",
      "usage_",
      "adminCache_",
      "wx_pops_cache_"
    ];

    for (const k of Object.keys(localStorage)) {
      if (
        prefixes.some(p => k.startsWith(p)) ||
        k === "hof_daily_cache_v2" ||
        k === "wx_pops_cache_v1"
      ) {
        localStorage.removeItem(k);
      }
    }

    for (const k of Object.keys(sessionStorage)) {
      if (prefixes.some(p => k.startsWith(p))) {
        sessionStorage.removeItem(k);
      }
    }

    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map(name => caches.delete(name)));
    }
  } catch (e) {
    console.warn("clearOldAppCachesOnBuildChange failed:", e);
  } finally {
    localStorage.setItem(BUILD_KEY, BUILD);
  }
}
// ✅ API_BASE（通常画面でも admin 設定値を優先）
const DEFAULT_API_BASE = "https://ancient-union-4aa4tatoete-kousui-api.y-yoshioka27.workers.dev";
function resolveApiBase(){
  try{
    const fromAdmin = String(localStorage.getItem("tatoete_admin_api_base") || "").trim();
    if (fromAdmin) return fromAdmin.replace(/\/+$/, "");
  }catch{}
  return DEFAULT_API_BASE;
}
const API_BASE = resolveApiBase();

// ✅ 殿堂入り日次スナップショット（GitHub Pages側に1日1回だけ配置）
const HOF_DAILY_JSON_URL = `${API_BASE}/api/hof_daily`;
const HOF_DAILY_CACHE_PREFIX = "hof_daily_cache_";
// 殿堂入りランキング描画で扱う件数は軽量化のため上限を固定
const HOF_RANK_LIMIT = 20;
let __hofSnapshotMemory = null;
let __hofSnapshotHtml = null;

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
  const memKey = "__usage_ping_day_mem_v1";
  const sessionKey = "usage_ping_day_session_v1";

  if (window[memKey] === day) return;

  try{
    const done = localStorage.getItem(dayKey);
    if (done === day) {
      window[memKey] = day;
      return;
    }
  }catch{}
  try{
    const doneS = sessionStorage.getItem(sessionKey);
    if (doneS === day) {
      window[memKey] = day;
      return;
    }
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
      window[memKey] = day;
      try{ localStorage.setItem(dayKey, day); }catch{}
      try{ sessionStorage.setItem(sessionKey, day); }catch{}
      return;
    }

    console.warn("usage ping not ok", res?.status, data);
  }catch(e){
    console.warn("usage ping failed", e?.message || e);
  }
}

async function pingUsageEvent(reason="weather_search"){
  const deviceId = getOrCreateDeviceId();
  const url = `${API_BASE}/api/usage/ping?d=${encodeURIComponent(deviceId)}&r=${encodeURIComponent(reason)}&v=${encodeURIComponent(BUILD)}`;

  try{
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5000);
    try{
      await fetch(url, {
        method:"POST",
        cache:"no-store",
        signal: ac.signal,
        keepalive: true,
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ deviceId, reason, v: BUILD })
      });
    } finally {
      clearTimeout(t);
    }
  }catch(e){
    console.warn("usage event ping failed", e?.message || e);
  }
}

async function pingWeatherSearchSuccess(){
  const deviceId = getOrCreateDeviceId();
  const url = `${API_BASE}/api/usage/weather_search_success?d=${encodeURIComponent(deviceId)}&v=${encodeURIComponent(BUILD)}`;
  try{
    await fetch(url, { method:"GET", cache:"no-store", keepalive:true });
  }catch(e){
    console.warn("weather search success ping failed", e?.message || e);
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
// ✅ 検索/ランキング request guard
// =========================
let __searchSeq = 0;
let __rankingReqSeq = 0;
let __freezeMetaphor = false;
window.__forceRepick = false;

function setSearchBusy(on){
  try{
    const card = document.getElementById("searchCard");
    if (card) card.classList.toggle("is-searching", !!on);

    const btn = document.getElementById("search");
    if (btn) btn.disabled = !!on;
  }catch(e){
    console.warn("setSearchBusy error", e);
  }
}

function setRankingBusy(on){
  try{
    const wrap = document.getElementById("todayRankingWrap");
    if (wrap) wrap.classList.toggle("is-updating", !!on);
  }catch(e){
    console.warn("setRankingBusy error", e);
  }
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

    const re = /(\d{1,3})\s*[%％]/g;
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
// ✅ いいね演出CSS + モードバッジCSS
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

    .latest-details summary{
      cursor:pointer;
      user-select:none;
      font-weight:900;
      list-style:none;
    }
    .latest-details summary::-webkit-details-marker{ display:none; }

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

const __loadingState = { text: "" };
function setLoadingStep(text){
  const el = document.getElementById("loadingText");
  if (!el) return;
  if (__loadingState.text === text) return;
  __loadingState.text = text;
  el.textContent = text;
}

function getConclusionByPop(pop){
  const p = Number(window.bucket10(pop));
  if (p <= 20) return { umbrella: "基本いらない", note: "雨の心配は低めです" };
  if (p <= 40) return { umbrella: "折りたたみ傘があると安心", note: "にわか雨に備えると安心です" };
  if (p <= 70) return { umbrella: "持った方が安心", note: "帰りに降る可能性があります" };
  return { umbrella: "必須", note: "しっかり降る見込みです" };
}

function renderConclusionCard({ pops, isCached=false } = {}){
  const card = document.getElementById("summaryCard");
  const main = document.getElementById("summaryMain");
  const sub = document.getElementById("summarySub");
  const note = document.getElementById("summaryNote");
  const badge = document.getElementById("summaryBadge");
  if (!card || !main || !sub || !note || !badge) return;

  if (!pops) {
    card.style.display = "none";
    return;
  }

  const vals = [pops.m, pops.d, pops.e].map(v => Number(v)).filter(Number.isFinite);
  if (!vals.length) {
    card.style.display = "none";
    return;
  }

  const pop = Math.max(...vals);
  const c = getConclusionByPop(pop);

  card.style.display = "block";
  main.textContent = `☂ 傘：${c.umbrella}`;
  sub.textContent = `降水確率：${pop}%`;
  note.textContent = `ひとこと：${c.note}`;
  badge.style.display = isCached ? "block" : "none";
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

// ==============================
// ✅ ネタ重複判定（canonical / dedupe）
// ==============================
function normalizeMetaphorText(text){
  return String(text || "")
    .normalize("NFKC")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\n+/g, "\n")
    .replace(/\s*[%％]\s*/g, "%")
    .replace(/\s*[:：]\s*/g, "：")
    .replace(/[‐-‒–—―ー]+/g, "ー")
    .replace(/[!！?？。．、,，;；]+$/g, "")
    .trim()
    .toLowerCase();
}

function makeMetaphorDedupeKey({ mode, bucket, text }){
  const m = (mode === "fun" ? "fun" : "trivia");
  const b = Number.isFinite(Number(bucket)) ? window.bucket10(Number(bucket)) : 0;
  const t = normalizeMetaphorText(text);
  return `m:${m}|b:${b}|t:${t}`;
}

function sourcePriority(source){
  const s = String(source || "");
  if (s === "public") return 4;
  if (s === "json") return 3;
  if (s === "base") return 2;
  if (s === "hof_daily") return 5;
  return 1;
}

function pickBetterText(a, b){
  const ta = String(a || "").trim();
  const tb = String(b || "").trim();
  if (!ta) return tb;
  if (!tb) return ta;
  if (tb.length > ta.length) return tb;
  return ta;
}

function pickBetterPenName(a, b){
  const pa = normalizePenName(a);
  const pb = normalizePenName(b);
  return pb || pa || null;
}

function numOrZero(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function readMergedTotalLikes(raw){
  if (!raw || typeof raw !== "object") return 0;
  return Math.max(
    numOrZero(raw.totalLikes),
    numOrZero(raw.likes_total),
    numOrZero(raw.likesTotal),
    numOrZero(raw.likes),
    numOrZero(raw?.meta?.likes)
  );
}

function readMergedTodayLikes(raw){
  if (!raw || typeof raw !== "object") return 0;
  return Math.max(
    numOrZero(raw.likesToday),
    numOrZero(raw.likes_today),
    numOrZero(raw.todayLikes),
    numOrZero(raw.likes)
  );
}

function mergeDisplayItems(items, { mode, bucket } = {}){
  const map = new Map();

  for (const raw of (Array.isArray(items) ? items : [])) {
    const text = String(raw?.text || "").trim();
    if (!text) continue;

    const itemMode = (raw?.mode === "fun" ? "fun" : (mode === "fun" ? "fun" : "trivia"));
    const itemBucket = Number.isFinite(Number(raw?.bucket))
      ? window.bucket10(Number(raw.bucket))
      : (Number.isFinite(Number(bucket)) ? window.bucket10(Number(bucket)) : 0);

    const key = makeMetaphorDedupeKey({ mode: itemMode, bucket: itemBucket, text });
    const current = map.get(key);

    if (!current) {
      map.set(key, {
        ...raw,
        text,
        mode: itemMode,
        bucket: itemBucket,
        source: raw?.source || null,
        id: raw?.id ? String(raw.id).trim() : null,
        penName: raw?.penName || null,
        totalLikes: readMergedTotalLikes(raw),
        likes: readMergedTodayLikes(raw),
        hof: !!raw?.hof,
        __dedupeKey: key,
        __canonText: normalizeMetaphorText(text),
      });
      continue;
    }

    const keepIncoming = sourcePriority(raw?.source) > sourcePriority(current?.source);

    current.text = pickBetterText(current.text, text);
    current.penName = pickBetterPenName(current.penName, raw?.penName);
    current.totalLikes = Math.max(Number(current.totalLikes || 0), readMergedTotalLikes(raw));
    current.likes = Math.max(Number(current.likes || 0), readMergedTodayLikes(raw));
    current.hof = !!current.hof || !!raw?.hof;
    current.__canonText = normalizeMetaphorText(current.text);

    if (keepIncoming) {
      current.source = raw?.source || current.source || null;
      current.id = raw?.id ? String(raw.id).trim() : (current.id || null);
      current.mode = itemMode;
      current.bucket = itemBucket;
    } else if (!current.id && raw?.id) {
      current.id = String(raw.id).trim();
    }
  }

  return Array.from(map.values());
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
async function fetchPublicMetaphors({ mode, bucket, limit = 1000 }) {
  const params = new URLSearchParams();
  if (mode) params.set("mode", mode);
  if (Number.isFinite(Number(bucket))) params.set("bucket", String(bucket));
  params.set("limit", String(limit));
  const needle = getDebugNeedle();
  if (needle.id) params.set("debug_id", needle.id);
  if (needle.text) params.set("debug_text", needle.text);

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
  const mapped = items
    .map(it => ({
      id: String(it.id || "").trim(),
      text: String(it.text || "").trim(),
      penName: (it.penName ? String(it.penName).trim() : null),
      totalLikes: readMergedTotalLikes(it),
      likes: readMergedTodayLikes(it),
      hof: !!it.hof,
      source: "public",
      mode: (it?.mode === "fun" ? "fun" : (mode === "fun" ? "fun" : "trivia")),
      bucket: Number.isFinite(Number(it?.bucket))
        ? window.bucket10(Number(it.bucket))
        : window.bucket10(Number(bucket))
    }))
    .filter(x => x.id && x.text);
  const ngFiltered = mapped.filter(x => !isNgText(x.text));
  const deduped = mergeDisplayItems(ngFiltered, { mode, bucket });

  const finalItems = deduped.map(x => {
  const flooredTotal = rememberTotalLikesFloor({
    mode,
    bucket,
    text: x.text,
    totalLikes: Number(x.totalLikes || 0)
  });

  return {
    id: x.id,
    text: x.text,
    penName: x.penName || null,
    totalLikes: flooredTotal,
    hof: !!x.hof || (flooredTotal >= Number(state.hofThreshold || 20))
  };
});

  try{
    console.log(
      `[debug] fetchPublicMetaphors mode=${mode} bucket=${window.bucket10(Number(bucket))} ` +
      `API返却件数=${items.length} 受信後件数=${mapped.length} フィルタ後件数=${ngFiltered.length} 描画直前件数=${finalItems.length} ` +
      `api_count=${Number(data?.count || 0)} api_total=${Number(data?.total || 0)} latest表示件数=${Number(data?.latestCount || 0)} limit=${limit} ` +
      `target_in_api=${hasDebugNeedle(items, needle)} target_in_received=${hasDebugNeedle(mapped, needle)} ` +
      `target_in_filtered=${hasDebugNeedle(ngFiltered, needle)} target_in_render=${hasDebugNeedle(finalItems, needle)}`
    );
  }catch{}

  return finalItems;
}
// ==============================
// ✅ 最新public（Workers /api/public_latest）
// ==============================
async function fetchPublicLatest(mode, limit = 10){
  const params = new URLSearchParams();
  if (mode) params.set("mode", mode);
  params.set("limit", String(limit));
  const needle = getDebugNeedle();
  if (needle.id) params.set("debug_id", needle.id);
  if (needle.text) params.set("debug_text", needle.text);

  return withApiGuard("public_latest", { mode: mode || "", limit }, async () => {
    const res = await fetch(`${API_BASE}/api/public_latest?${params.toString()}`, { method: "GET", cache: "no-store" });
    if (!res.ok) throw new Error(`public_latest fetch failed: ${res.status}`);
    const data = await res.json().catch(()=>null);
    if (!data?.ok) throw new Error("public_latest not ok");
    const items = Array.isArray(data.items) ? data.items : [];

    try{
      console.log(
        `[debug] fetchPublicLatest mode=${mode || "all"} latest表示件数=${items.length} ` +
        `api_count=${Number(data?.count || 0)} api_total=${Number(data?.total || 0)} target_in_latest=${hasDebugNeedle(items, needle)}`
      );
    }catch{}
    return items;
  });
}

// ==============================
// ✅ いいね（Workers）
// ==============================
async function likeAny(payload){
  const cid = getClientId();
  const endpoint = `${API_BASE}/api/like`;
  const requestBody = {
    ...payload,
    clientId: cid,
  };
  let res = null;
  let responseText = "";
  try {
    res = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type":"application/json",
        "x-client-id": cid,
      },
      body: JSON.stringify(requestBody)
    });

    responseText = await res.text().catch(() => "");
    const data = (() => {
      try { return responseText ? JSON.parse(responseText) : null; } catch { return null; }
    })();

    if (!res.ok || !data?.ok) {
      console.error("[likeAny] response error", {
        endpoint,
        requestBody,
        status: res.status,
        statusText: res.statusText,
        responseText,
      });
      const detail = data?.detail || data?.error || responseText || `http_${res.status}`;
      const err = new Error(String(detail));
      err.status = res.status;
      throw err;
    }
    if (data.hofThreshold != null) state.hofThreshold = Number(data.hofThreshold || state.hofThreshold || 20);
    return data;
  } catch (e) {
    console.error("[likeAny] fetch exception", {
      endpoint,
      requestBody,
      status: res?.status ?? null,
      statusText: res?.statusText ?? null,
      responseText,
      fetchMessage: e?.message || String(e),
    });
    throw e;
  }
}

// ==============================
// 今日のランキング（Workers）
// ==============================
const API_GUARD_TTL_MS = 30 * 1000;
const apiGuardCache = new Map();
const apiGuardInFlight = new Map();

function guardCacheKey(name, params){
  return `${name}:${JSON.stringify(params || {})}`;
}

async function withApiGuard(name, params, fn){
  const key = guardCacheKey(name, params);
  const now = Date.now();
  const cached = apiGuardCache.get(key);
  if (cached && now - Number(cached.at || 0) < API_GUARD_TTL_MS) {
    return cached.value;
  }

  if (apiGuardInFlight.has(key)) {
    return apiGuardInFlight.get(key);
  }

  const p = (async () => {
    const value = await fn();
    apiGuardCache.set(key, { at: Date.now(), value });
    return value;
  })().finally(() => {
    apiGuardInFlight.delete(key);
  });

  apiGuardInFlight.set(key, p);
  return p;
}

async function fetchRankingToday(mode, bucket, limit = 3){
  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("bucket", String(bucket));
  params.set("limit", String(limit));
  return withApiGuard("ranking_today", { mode, bucket, limit }, async () => {
    const res = await fetch(`${API_BASE}/api/ranking/today?${params.toString()}`, { method:"GET", cache:"no-store" });
    const data = await res.json().catch(()=>null);
    if (!res.ok || !data?.ok) throw new Error(data?.error || `ranking failed ${res.status}`);
    return Array.isArray(data.items) ? data.items : [];
  });
}

// ✅ 今日の総合ランキング（全バケット共通）
async function fetchRankingTodayAll(mode, limit = 3){
  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("limit", String(limit));
  return withApiGuard("ranking_today_all", { mode, limit }, async () => {
    const res = await fetch(`${API_BASE}/api/ranking/today_all?${params.toString()}`, { method:"GET", cache:"no-store" });
    const data = await res.json().catch(()=>null);
    if (!res.ok || !data?.ok) throw new Error(data?.error || `ranking today_all failed ${res.status}`);
    return Array.isArray(data.items) ? data.items : [];
  });
}

async function fetchRankingTotal(mode, bucket, limit = 3){
  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("bucket", String(bucket));
  params.set("limit", String(limit));
  return withApiGuard("ranking_total", { mode, bucket, limit }, async () => {
    const res = await fetch(`${API_BASE}/api/ranking/total?${params.toString()}`, { method:"GET", cache:"no-store" });
    const data = await res.json().catch(()=>null);
    if (!res.ok || !data?.ok) throw new Error(data?.error || `ranking total failed ${res.status}`);
    if (data.hofThreshold != null) state.hofThreshold = Number(data.hofThreshold || state.hofThreshold || 20);
    return Array.isArray(data.items) ? data.items : [];
  });
}

// ✅ 殿堂入り（従来API / フォールバック用）
async function fetchHallOfFame(mode, bucket, limit = 50){
  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("limit", String(limit));
  params.set("scope", "all");
  return withApiGuard("hof", { mode, bucket, limit }, async () => {
    const res = await fetch(`${API_BASE}/api/hof?${params.toString()}`, { method:"GET", cache:"no-store" });
    const data = await res.json().catch(()=>null);
    if (!res.ok || !data?.ok) throw new Error(data?.error || `hof failed ${res.status}`);
    if (data.hofThreshold != null) state.hofThreshold = Number(data.hofThreshold || state.hofThreshold || 20);
    return Array.isArray(data.items) ? data.items : [];
  });
}

function normalizeHallSnapshotItem(raw){
  const mode = (raw?.mode === "fun" ? "fun" : "trivia");
  const text = String(raw?.text || "").trim();
  if (!text) return null;

  return {
    id: raw?.id ? String(raw.id).trim() : makeGlobalId({
      mode,
      bucket: Number.isFinite(Number(raw?.bucket)) ? Number(raw.bucket) : 0,
      text,
      source: "hof_daily"
    }),
    text,
    penName: raw?.penName ? String(raw.penName).trim() : null,
    totalLikes: readMergedTotalLikes(raw),
    likes: readMergedTodayLikes(raw),
    bucket: Number.isFinite(Number(raw?.bucket)) ? window.bucket10(Number(raw.bucket)) : 0,
    mode,
    hof: true,
    source: "hof_daily"
  };
}
function extractHallSnapshotItemsFromPayload(data){
  const a = Array.isArray(data?.items) ? data.items : [];
  const t = Array.isArray(data?.triviaItems) ? data.triviaItems : (Array.isArray(data?.trivia) ? data.trivia : []);
  const f = Array.isArray(data?.funItems) ? data.funItems : (Array.isArray(data?.fun) ? data.fun : []);

  return mergeDisplayItems(
    [
      ...a.map(it => ({
        ...it,
        mode: (it?.mode === "fun" ? "fun" : "trivia"),
        source: "hof_daily"
      })),
      ...t.map(it => ({
        ...it,
        mode: "trivia",
        source: "hof_daily"
      })),
      ...f.map(it => ({
        ...it,
        mode: "fun",
        source: "hof_daily"
      }))
    ]
      .map(normalizeHallSnapshotItem)
      .filter(Boolean)
      .filter(it => !isNgText(it.text))
  ).sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));
}

function hasHallMode(items, mode){
  const m = (mode === "fun" ? "fun" : "trivia");
  return (Array.isArray(items) ? items : []).some(it => (it?.mode === "fun" ? "fun" : "trivia") === m);
}

async function fetchHallModeFromApiOnce(mode, limit = 100){
  const arr = await fetchHallOfFame(mode, 0, limit);

  return mergeDisplayItems(
    (Array.isArray(arr) ? arr : [])
      .map(it => ({
        ...it,
        mode: (mode === "fun" ? "fun" : "trivia"),
        source: "public"
      }))
      .map(normalizeHallSnapshotItem)
      .filter(Boolean)
      .filter(it => !isNgText(it.text))
  ).sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));
}
function hallDailyCacheKey(day){
  return `${HOF_DAILY_CACHE_PREFIX}${day}`;
}
function saveHallDailyCache(payload){
  try{
    const day = String(payload?.day || todayJSTString());
    localStorage.setItem(hallDailyCacheKey(day), JSON.stringify(payload));
  }catch{}
}
function loadHallDailyCache(day = todayJSTString()){
  try{
    return JSON.parse(localStorage.getItem(hallDailyCacheKey(day)) || "null");
  }catch{
    return null;
  }
}

  
async function fetchHallOfFameDaily(limit = 100){
  const today = todayJSTString();
  const url = `${HOF_DAILY_JSON_URL}?day=${encodeURIComponent(today)}&_=${Date.now()}`;

  const res = await fetch(url, { method:"GET", cache:"no-store" });
  const data = await res.json().catch(()=>null);

  // ✅ Worker 側の失敗は empty 扱いせず、そのまま失敗として投げる
  if (!res.ok || !data?.ok) {
    const msg =
      data?.detail ||
      data?.error ||
      data?.fallbackReason ||
      `hof_daily failed ${res.status}`;
    throw new Error(msg);
  }

  const items = mergeDisplayItems(
  extractHallSnapshotItemsFromPayload(data)
).sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));

rememberHallSnapshotTotals(items);
  const hofThreshold = Number(data?.hofThreshold || state.hofThreshold || 20);
  state.hofThreshold = hofThreshold;

  // ✅ 成功時だけキャッシュ保存
  const payload = {
    day: today,
    generatedAt: data?.generatedAt || null,
    hofThreshold,
    items
  };
  saveHallDailyCache(payload);

  return {
    generatedAt: payload.generatedAt,
    hofThreshold,
    items: items.slice(0, limit)
  };
}  
async function fetchHallOfFameForRanking(limit = HOF_RANK_LIMIT){
  const daily = await fetchHallOfFameDaily(limit);

  return {
    generatedAt: daily?.generatedAt || null,
    hofThreshold: Number(daily?.hofThreshold || state.hofThreshold || 20),
    items: Array.isArray(daily?.items) ? daily.items.slice(0, limit) : []
  };
}

    
function buildHallCardHtmlFromSnapshot(hofData){
  const hofTh = Number(hofData?.hofThreshold || state.hofThreshold || 20);
  const generatedAt = hofData?.generatedAt ? String(hofData.generatedAt) : null;

  const hofItems = (Array.isArray(hofData?.items) ? hofData.items : [])
    .map(it => ({
      ...it,
      text: String(it?.text || "").trim(),
      penName: it?.penName ? String(it.penName).trim() : null,
      totalLikes: readMergedTotalLikes(it),
      likes: readMergedTodayLikes(it),
      bucket: Number.isFinite(Number(it?.bucket)) ? window.bucket10(Number(it.bucket)) : 0,
      mode: (it?.mode === "fun" ? "fun" : "trivia"),
      hof: true,
      source: it?.source || "hof_daily"
    }))
    .filter(it => it.text)
    .filter(it => !isNgText(it.text))
    .sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));

  if (!hofItems.length) {
    return `
      <div id="rankHofCard" class="card" style="margin:0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
        <div style="font-weight:900; font-size:16px; margin-bottom:6px;">殿堂入り（全モード共通 / 累計👍${hofTh}以上）</div>
        <div class="muted" style="margin-bottom:8px;">※殿堂入りは1日1回集計</div>
        <div class="muted">まだ殿堂入りがありません（累計👍${hofTh}以上が0件、または本日JSON未生成）</div>
      </div>
    `;
  }

  const top10 = hofItems.slice(0, 5);
　const restItems = hofItems.slice(5);

  const renderHofRow = (it, idx) => {
    const pen = penHtmlIfAny(it.penName);
    const totalLikes = Number(it.totalLikes || 0);
    const md = (it.mode === "fun") ? "fun" : "trivia";
    return `
      <div style="padding:10px 0; border-top:1px solid rgba(15,23,42,0.10);">
        <div style="font-weight:800;">
          ${idx + 1}. ${escapeHtml(it.text)}${pen}${modeBadgeHtml(md)}
          <span class="hof-badge">👑殿堂入り</span>
        </div>
        <div class="muted">累計👍：${totalLikes}</div>
      </div>
    `;
  };

  const topRows = top10.map((it, idx) => renderHofRow(it, idx)).join("");
  const restRows = restItems.map((it, idx) => renderHofRow(it, idx + 5)).join("");

  const snapshotNote = generatedAt
    ? `<div class="muted" style="margin-bottom:8px;">※殿堂入りは1日1回集計 / 生成: ${escapeHtml(generatedAt)}</div>`
    : `<div class="muted" style="margin-bottom:8px;">※殿堂入りは1日1回集計</div>`;

  return `
    <div id="rankHofCard" class="card" style="margin:0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
      <div style="font-weight:900; font-size:16px; margin-bottom:6px;">殿堂入り（全モード共通 / 累計👍${hofTh}以上）</div>
      ${snapshotNote}
      <div>${topRows}</div>
      ${restItems.length ? `
        <div style="margin-top:8px; font-weight:800; color:#475569;">6位以下</div>
        <div style="max-height:360px; overflow-y:scroll; margin-top:6px; padding:0 8px 0 0; border-top:1px solid rgba(15,23,42,0.08); overscroll-behavior:contain; scrollbar-gutter:stable;">
          ${restRows}
        </div>
      ` : ``}
    </div>
  `;
}
async function ensureHallSnapshotLoaded(force = false){
  const today = todayJSTString();

  const dailyCached = !force ? loadHallDailyCache(today) : null;
  if (dailyCached?.day === today && Array.isArray(dailyCached?.items)) {
    __hofSnapshotMemory = {
      day: today,
      generatedAt: dailyCached?.generatedAt || null,
      hofThreshold: Number(dailyCached?.hofThreshold || state.hofThreshold || 20),
      items: dailyCached.items.slice(0, HOF_RANK_LIMIT)
    };
    __hofSnapshotHtml = buildHallCardHtmlFromSnapshot(__hofSnapshotMemory);
    return __hofSnapshotMemory;
  }

  try {
    const hofData = await fetchHallOfFameForRanking(HOF_RANK_LIMIT);

    __hofSnapshotMemory = {
      day: today,
      generatedAt: hofData?.generatedAt || null,
      hofThreshold: Number(hofData?.hofThreshold || state.hofThreshold || 20),
      items: Array.isArray(hofData?.items) ? hofData.items : []
    };
    __hofSnapshotHtml = buildHallCardHtmlFromSnapshot(__hofSnapshotMemory);
    return __hofSnapshotMemory;
  } catch (e) {
    if (!force && __hofSnapshotMemory?.day === today && Array.isArray(__hofSnapshotMemory.items) && __hofSnapshotMemory.items.length) {
      return __hofSnapshotMemory;
    }
    throw e;
  }
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
        text: String(it.text || "").trim(),
        source: "json"
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
        text: String(it?.text || "").trim(),
        source: "json"
      })).filter(x => x.text) : []);

  return base
    .filter(x => x.mode === m && x.bucket === b)
    .filter(x => !isNgText(x.text));
}

// ==============================
// ✅ publicネタ（Workers /api/public）キャッシュ
// ==============================
const publicCache = new Map();
const publicCacheMeta = new Map();
const totalLikesFloor = new Map();
const hallSnapshotTotals = new Map();
const PUBLIC_CACHE_TTL_MS = 60 * 1000;

function getDebugNeedle(){
  try{
    const usp = new URLSearchParams(window.location.search || "");
    const id = String(usp.get("debug_id") || localStorage.getItem("debug_id") || "").trim();
    const text = normalizeMetaphorText(String(usp.get("debug_text") || localStorage.getItem("debug_text") || ""));
    return { id, text };
  }catch{
    return { id: "", text: "" };
  }
}

function hasDebugNeedle(items, needle = getDebugNeedle()){
  if (!needle?.id && !needle?.text) return "n/a";
  const arr = Array.isArray(items) ? items : [];
  return arr.some((it) => {
    const byId = needle.id && String(it?.id || "").trim() === needle.id;
    const byText = needle.text && normalizeMetaphorText(String(it?.text || "")) === needle.text;
    return byId || byText;
  });
}

function hallSnapshotKeyForItem(mode, bucket, text){
  const m = (mode === "fun" ? "fun" : "trivia");
  const b = Number.isFinite(Number(bucket)) ? window.bucket10(Number(bucket)) : 0;
  const t = normalizeMetaphorText(text || "");
  return `m:${m}|b:${b}|t:${t}`;
}

function rememberHallSnapshotTotals(items){
  hallSnapshotTotals.clear();

  for (const it of (Array.isArray(items) ? items : [])) {
    const text = String(it?.text || "").trim();
    if (!text) continue;

    const mode = (it?.mode === "fun" ? "fun" : "trivia");
    const bucket = Number.isFinite(Number(it?.bucket))
      ? window.bucket10(Number(it.bucket))
      : 0;
    const totalLikes = readMergedTotalLikes(it);

    const key = hallSnapshotKeyForItem(mode, bucket, text);
    hallSnapshotTotals.set(key, Math.max(Number(hallSnapshotTotals.get(key) || 0), totalLikes));
  }
}

function getHallSnapshotTotalLikes(mode, bucket, text){
  const key = hallSnapshotKeyForItem(mode, bucket, text);
  if (!hallSnapshotTotals.has(key)) return null;
  return Number(hallSnapshotTotals.get(key) || 0);
}

function resolveDisplayTotalLikes(mode, bucket, text, totalLikes){
  const current = applyTotalLikesFloor({ mode, bucket, text, totalLikes });
  const snap = getHallSnapshotTotalLikes(mode, bucket, text);
  if (snap !== null) return Math.max(current, Number(snap || 0));
  return current;
}

function floorKeyForItem(mode, bucket, text){
  const m = (mode === "fun" ? "fun" : "trivia");
  const b = Number.isFinite(Number(bucket)) ? window.bucket10(Number(bucket)) : 0;
  const t = normalizeMetaphorText(text || "");
  return `m:${m}|b:${b}|t:${t}`;
}

function rememberTotalLikesFloor({ mode, bucket, text, totalLikes }){
  const key = floorKeyForItem(mode, bucket, text);
  const prev = Number(totalLikesFloor.get(key) || 0);
  const next = Math.max(prev, Number(totalLikes || 0));
  totalLikesFloor.set(key, next);
  return next;
}

function applyTotalLikesFloor({ mode, bucket, text, totalLikes }){
  const key = floorKeyForItem(mode, bucket, text);
  const floor = Number(totalLikesFloor.get(key) || 0);
  return Math.max(Number(totalLikes || 0), floor);
}
function rememberHallSnapshotFloors(items){
  for (const it of (Array.isArray(items) ? items : [])) {
    const text = String(it?.text || "").trim();
    if (!text) continue;

    const mode = (it?.mode === "fun" ? "fun" : "trivia");
    const bucket = Number.isFinite(Number(it?.bucket)) ? window.bucket10(Number(it.bucket)) : 0;
    const totalLikes = Number(it?.totalLikes || 0);

    rememberTotalLikesFloor({
      mode,
      bucket,
      text,
      totalLikes
    });
  }
}
function patchPublicCacheItem(mode, bucket, text, patch = {}){
  const k = keyMB(mode, bucket);
  const arr = publicCache.get(k);
  if (!Array.isArray(arr) || !arr.length) return;

  const canon = normalizeMetaphorText(text || "");
  let changed = false;

  const next = arr.map(it => {
    if (normalizeMetaphorText(it?.text || "") !== canon) return it;

    changed = true;
    const mergedTotal = Math.max(
      Number(it?.totalLikes || 0),
      Number(patch?.totalLikes || 0)
    );
    const mergedLikesToday = Math.max(
      Number(it?.likesToday || it?.likes || 0),
      Number(patch?.likesToday || patch?.likes || 0)
    );

    rememberTotalLikesFloor({
      mode,
      bucket,
      text,
      totalLikes: mergedTotal
    });

    return {
      ...it,
      totalLikes: applyTotalLikesFloor({
        mode,
        bucket,
        text,
        totalLikes: mergedTotal
      }),
      likes: mergedLikesToday,
      likesToday: mergedLikesToday,
      hof: !!patch?.hof || !!it?.hof || (mergedTotal >= Number(state.hofThreshold || 20))
    };
  });

  if (changed) {
    publicCache.set(k, next);
  }
}
const publicInFlight = new Map();

function keyMB(mode, bucket){
  const m = (mode === "fun" ? "fun" : "trivia");
  const b = window.bucket10(bucket);
  return `${m}_${b}`;
}

function uniqueBucketsFromPops(pops){
  try{
    const arr = [pops?.m, pops?.d, pops?.e].map(v => window.bucket10(v ?? 0));
    return Array.from(new Set(arr));
  }catch{
    return [];
  }
}

async function warmPublicCache(mode, bucket){
  const k = keyMB(mode, bucket);
  const now = Date.now();

  if (publicCache.has(k)) {
    const cachedAt = Number(publicCacheMeta.get(k) || 0);
    if (now - cachedAt < PUBLIC_CACHE_TTL_MS) return publicCache.get(k) || [];
  }

  const inflight = publicInFlight.get(k);
  if (inflight) return inflight;

  const p = (async () => {
    try{
      const items = await fetchPublicMetaphors({
        mode: (mode === "fun" ? "fun" : "trivia"),
        bucket: window.bucket10(bucket),
        limit: 1000
      });
      publicCache.set(k, items);
      publicCacheMeta.set(k, Date.now());
      try{
        console.log(`[debug] warmPublicCache key=${k} fetched=${items.length} ttlMs=${PUBLIC_CACHE_TTL_MS}`);
      }catch{}
      return items;
    }catch{
      publicCache.set(k, []);
      publicCacheMeta.set(k, Date.now());
      return [];
    }finally{
      publicInFlight.delete(k);
    }
  })();

  publicInFlight.set(k, p);
  return p;
}

// ==============================
// ✅ publicデバッグ（管理画面 or コンソール向け）
// 使い方:
//   await window.debugPublicItem("t_trivia_420451fb", "trivia", 0)
// ==============================
window.debugPublicItem = async function debugPublicItem(id, mode = "trivia", bucket = 0){
  const itemId = String(id || "").trim();
  if (!itemId) throw new Error("id is required");

  const m = (mode === "fun" ? "fun" : "trivia");
  const b = window.bucket10(Number(bucket || 0));
  const params = new URLSearchParams({
    id: itemId,
    mode: m,
    bucket: String(b)
  });

  const url = `${API_BASE}/api/admin/debug_item?${params.toString()}`;
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `debug_item failed: ${res.status}`);
  }

  try{
    const c = data.checks || {};
    console.log(
      `[debug] id=${itemId} ` +
      `publicKey=${!!c?.publicKey?.exists} ` +
      `idx_public_all=${!!c?.indexPublicAll?.exists} ` +
      `idx_mode_bucket=${!!c?.indexModeBucket?.exists} ` +
      `idx_public_latest=${!!c?.indexPublicLatest?.exists} ` +
      `in_candidate=${!!c?.appCandidate?.inModeBucketFiltered} ` +
      `excludedBy=${Array.isArray(c?.appCandidate?.excludedBy) ? c.appCandidate.excludedBy.join(",") : ""}`
    );
  }catch{}

  return data;
};

function getPublicItems(mode, bucket){
  const k = keyMB(mode, bucket);
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

function findPublicLikeSeed(mode, bucket, text){
  const k = keyMB(mode, bucket);
  const arr = publicCache.get(k) || [];
  const canon = normalizeMetaphorText(text || "");
  if (!canon || !Array.isArray(arr) || !arr.length) return null;

  const hit = arr.find(it => normalizeMetaphorText(it?.text || "") === canon);
  if (!hit) return null;

  const totalLikes = Number(hit.totalLikes || 0);
  rememberTotalLikesFloor({
    mode,
    bucket,
    text,
    totalLikes
  });

  return {
    id: hit.id ? String(hit.id).trim() : null,
    penName: hit.penName || null,
    totalLikes: applyTotalLikesFloor({
      mode,
      bucket,
      text,
      totalLikes
    }),
    hof: !!hit.hof || (totalLikes >= Number(state.hofThreshold || 20))
  };
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
const WEATHER_LAST_SUCCESS_KEY = "weather_last_success_v1";
const WX_CACHE_TTL_MS = 10 * 60 * 1000;
// 通信失敗時のフォールバックは「新しめ」のみ許容
const WX_FALLBACK_MAX_STALE_MS = 30 * 60 * 1000;
const SAME_SEARCH_SUPPRESS_MS = 30 * 1000;
let __lastWeatherFetchSig = null;
let __lastWeatherFetchAt = 0;

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
function clearWxCacheByLatLon(lat, lon){
  try{
    const key = wxKey(lat, lon);
    const cache = loadWxCache();
    if (cache && Object.prototype.hasOwnProperty.call(cache, key)) {
      delete cache[key];
      saveWxCache(cache);
    }
  }catch(e){
    console.warn("clearWxCacheByLatLon failed", e);
  }
}
function saveLastSuccessWeather(payload){
  try{
    localStorage.setItem(WEATHER_LAST_SUCCESS_KEY, JSON.stringify({
      ...payload,
      savedAt: Date.now()
    }));
  }catch{}
}
function loadLastSuccessWeather(){
  try{
    return JSON.parse(localStorage.getItem(WEATHER_LAST_SUCCESS_KEY) || "null");
  }catch{
    return null;
  }
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
  isCachedResult: false,
  currentPhrases: {
    m: { text: null, source: null, id: null, penName: null, likesToday: 0, totalLikes: 0, hof: false, mode: null, bucket: null, dedupeKey: null },
    d: { text: null, source: null, id: null, penName: null, likesToday: 0, totalLikes: 0, hof: false, mode: null, bucket: null, dedupeKey: null },
    e: { text: null, source: null, id: null, penName: null, likesToday: 0, totalLikes: 0, hof: false, mode: null, bucket: null, dedupeKey: null }
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
  const b = Number.isFinite(Number(bucket)) ? window.bucket10(Number(bucket)) : 0;
  const t = normalizeMetaphorText(text);
  return `t_${m}_${b}_${fnv1a32(`${m}|${b}|${t}`)}`;
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
function buildHallCanonicalTop20(){
  const hofTh = Number(state.hofThreshold || 20);
  const all = [];

  for (const mode of ["trivia", "fun"]) {
    for (let b = 0; b <= 100; b += 10) {
      const pool = buildCandidatePool(mode, b);
      for (const it of pool) {
        if (!it?.text) continue;
        all.push({
          id: it.id || makeGlobalId({ mode, bucket: b, text: it.text, source: it.source || "base" }),
          text: String(it.text || "").trim(),
          penName: it.penName || null,
          totalLikes: Number(it.totalLikes || 0),
          likes: Number(it.likes || 0),
          bucket: b,
          mode,
          hof: !!it.hof || (Number(it.totalLikes || 0) >= hofTh),
          source: it.source || "base"
        });
      }
    }
  }

  return mergeDisplayItems(all)
    .filter(it => Number(it.totalLikes || 0) >= hofTh)
    .sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0))
    .slice(0, 20);
}

function buildCandidatePool(mode, bucket) {
  const b = window.bucket10(bucket);
  const m = (mode === "fun" ? "fun" : "trivia");

  const baseItems = getBaseTexts(m, b).map(text => {
  const seed = findPublicLikeSeed(m, b, text);
  return {
    text,
    source: "base",
    id: makeGlobalId({ mode: m, bucket: b, text, source: "base" }),
    penName: seed?.penName || null,
    totalLikes: Number(seed?.totalLikes || 0),
    hof: !!seed?.hof,
    mode: m,
    bucket: b
  };
});

  const jsonItems = getSharedItems(m, b).map(x => {
  const seed = findPublicLikeSeed(m, b, x.text);
  return {
    text: x.text,
    source: "json",
    id: makeGlobalId({ mode: m, bucket: b, text: x.text, source: "json" }),
    penName: seed?.penName || null,
    totalLikes: Number(seed?.totalLikes || 0),
    hof: !!seed?.hof,
    mode: m,
    bucket: b
  };
});

  const publicItems = getPublicItems(m, b).map(x => ({
    ...x,
    mode: m,
    bucket: b
  }));

  const merged = mergeDisplayItems([...publicItems, ...jsonItems, ...baseItems], { mode: m, bucket: b });

    return merged
    .map(item => {
      const text = String(item?.text || "").trim();
      const totalLikes = applyTotalLikesFloor({
        mode: m,
        bucket: b,
        text,
        totalLikes: Number(item?.totalLikes || 0)
      });

      return {
        text,
        source: item.source || "base",
        id: item.id || makeGlobalId({ mode: m, bucket: b, text: item?.text || "", source: item.source || "base" }),
        penName: item.penName || null,
        totalLikes,
        likes: Number(item.likes || 0),
        hof: !!item.hof || (totalLikes >= Number(state.hofThreshold || 20)),
        bucket: b,
        mode: m,
        dedupeKey: makeMetaphorDedupeKey({ mode: m, bucket: b, text: item?.text || "" })
      };
    })
    .filter(item => item.text)
    .filter(item => !isNgText(item.text))
    .filter(item => !hasHard100PercentMismatch(item.text, b))
    .filter(item => !hasMismatchedPercent(item.text, b));
}
const lastPickKey = {};

function pickMetaphor(mode, bucket) {
  const b = window.bucket10(bucket);
  const pool = buildCandidatePool(mode, b);

  if (!pool.length) {
    return {
      text: "データなし",
      source: null,
      id: null,
      penName: null,
      totalLikes: 0,
      hof: false,
      bucket: b,
      mode,
      dedupeKey: null
    };
  }

  const key = `${mode}_${b}`;
  const publicPool = pool.filter(x => x.source === "public");
  const basePool = pool.filter(x => x.source !== "public");
  const usePublic = publicPool.length > 0;
  let picked;

  if (usePublic) {
    const hist = lastPickKey[key];
    const lastPublicIndex = Number.isFinite(Number(hist?.publicIndex)) ? Number(hist.publicIndex) : -1;
    let nextIndex = (lastPublicIndex + 1) % publicPool.length;

    if (publicPool.length > 1) {
      const prevKey = String(hist?.dedupeKey || "");
      let guard = 0;
      while ((publicPool[nextIndex]?.dedupeKey || publicPool[nextIndex]?.text) === prevKey && guard < publicPool.length) {
        nextIndex = (nextIndex + 1) % publicPool.length;
        guard++;
      }
    }

    picked = publicPool[nextIndex];

    if (basePool.length > 0 && Math.random() < 0.05) {
      picked = basePool[Math.floor(Math.random() * basePool.length)];
    }
  } else {
    picked = pool[Math.floor(Math.random() * pool.length)];
  }

  if (pool.length > 1) {
    let attempts = 0;
    while ((picked.dedupeKey || picked.text) === String(lastPickKey[key]?.dedupeKey || "") && attempts < 8) {
      if (usePublic) {
        const hist = lastPickKey[key];
        const idx = Number.isFinite(Number(hist?.publicIndex)) ? Number(hist.publicIndex) : -1;
        picked = publicPool[(idx + 1 + attempts) % publicPool.length];
      } else {
        picked = pool[Math.floor(Math.random() * pool.length)];
      }
      attempts++;
    }
  }

  const publicIndex = usePublic ? publicPool.findIndex(it => (it.dedupeKey || it.text) === (picked.dedupeKey || picked.text)) : -1;
  lastPickKey[key] = {
    dedupeKey: picked.dedupeKey || picked.text,
    publicIndex
  };

  try{
    const needle = getDebugNeedle();
    console.log(
      `[debug] pickMetaphor mode=${mode} bucket=${b} pool=${pool.length} publicPool=${publicPool.length} ` +
      `描画直前件数=${pool.length} pickedSource=${picked?.source || "unknown"} target_in_pool=${hasDebugNeedle(pool, needle)}`
    );
  }catch{}
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

  const ok = (!!phraseObj?.id || !!phraseObj?.text) && !!phraseObj?.text && !isNgText(phraseObj.text);
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
    const livePhrase = state.currentPhrases[slot] || phraseObj;
    const prevToday = Number(livePhrase?.likesToday || 0);
    const prevTotal = Number(livePhrase?.totalLikes || 0);
    const optimisticToday = prevToday + 1;
    const optimisticTotal = prevTotal + 1;

    if (livePhrase) {
      livePhrase.likesToday = optimisticToday;
      livePhrase.totalLikes = rememberTotalLikesFloor({
        mode: livePhrase.mode || getSelectedMode(),
        bucket: Number(livePhrase.bucket ?? 0),
        text: livePhrase.text,
        totalLikes: optimisticTotal
      });
      livePhrase.hof = !!livePhrase.hof || (livePhrase.totalLikes >= Number(state.hofThreshold || 20));
    }

    patchPublicCacheItem(
      livePhrase?.mode || getSelectedMode(),
      Number(livePhrase?.bucket ?? 0),
      livePhrase?.text,
      {
        likesToday: optimisticToday,
        likes: optimisticToday,
        totalLikes: optimisticTotal,
        hof: !!livePhrase?.hof
      }
    );

    updateLikeUI(slot);
    likeFxPop(btnEl);
    likeFxPlusOne(btnEl);

    btnEl.disabled = true;
    let likeLimitReached = false;
    try{
      const out = await likeAny({
        id: phraseObj.id || phraseObj.dedupeKey || makeMetaphorDedupeKey({ mode: phraseObj.mode || getSelectedMode(), bucket: Number(phraseObj.bucket ?? 0), text: phraseObj.text || "" }),
        mode: phraseObj.mode || getSelectedMode(),
        bucket: Number(phraseObj.bucket ?? 0),
        text: phraseObj.text,
        penName: normalizePenName(phraseObj.penName),
        source: phraseObj.source || null,
        clientId: getClientId(),
      });
      const nowPhrase = state.currentPhrases[slot] || livePhrase;
      const nextToday = Number(out.likesToday ?? out.displayedLikeCount ?? optimisticToday);
      const nextTotal = Number(out.canonicalTotal ?? out.total ?? out.totalLikes ?? out.totalLikeCount ?? optimisticTotal);

      const safeToday = nextToday;
      const safeTotal = rememberTotalLikesFloor({
        mode: nowPhrase?.mode || getSelectedMode(),
        bucket: Number(nowPhrase?.bucket ?? 0),
        text: nowPhrase?.text,
        totalLikes: nextTotal
      });

      if (nowPhrase) {
        nowPhrase.likesToday = safeToday;
        nowPhrase.totalLikes = safeTotal;
        nowPhrase.hof = !!out.hof || (safeTotal >= Number(state.hofThreshold || 20));
      }

      patchPublicCacheItem(
        nowPhrase?.mode || getSelectedMode(),
        Number(nowPhrase?.bucket ?? 0),
        nowPhrase?.text,
        {
          likesToday: safeToday,
          likes: safeToday,
          totalLikes: safeTotal,
          hof: !!nowPhrase?.hof
        }
      );

__hofSnapshotMemory = null;
__hofSnapshotHtml = null;

updateLikeUI(slot);
    }catch(e){
      console.error("[like] failed", {
        reason: e?.message || e,
        endpoint: `${API_BASE}/api/like`,
        id: phraseObj?.id,
        mode: phraseObj?.mode || getSelectedMode(),
        bucket: Number(phraseObj?.bucket ?? 0),
      });
      const rollbackPhrase = state.currentPhrases[slot] || livePhrase;
      if (rollbackPhrase) {
        rollbackPhrase.likesToday = prevToday;
        rollbackPhrase.totalLikes = rememberTotalLikesFloor({
          mode: rollbackPhrase.mode || getSelectedMode(),
          bucket: Number(rollbackPhrase.bucket ?? 0),
          text: rollbackPhrase.text,
          totalLikes: prevTotal
        });
        rollbackPhrase.hof = !!rollbackPhrase.hof || (rollbackPhrase.totalLikes >= Number(state.hofThreshold || 20));
      }

      patchPublicCacheItem(
        rollbackPhrase?.mode || getSelectedMode(),
        Number(rollbackPhrase?.bucket ?? 0),
        rollbackPhrase?.text,
        {
          likesToday: prevToday,
          likes: prevToday,
          totalLikes: prevTotal,
          hof: !!rollbackPhrase?.hof
        }
      );

      updateLikeUI(slot);
      const errStatus = Number(e?.status || 0) || 0;
      const errMessage = String(e?.message || "");
      likeLimitReached = (errStatus === 429) && /like limit/i.test(errMessage);
      if (likeLimitReached) {
        btnEl.disabled = true;
        setStatus("本日のいいね上限（10回）に達しました", "ng");
      } else {
        setStatus("いいねの反映に失敗しました", "ng");
      }
    }finally{
      if (!likeLimitReached) btnEl.disabled = false;
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
      likesToday: 0, totalLikes: 0, hof: false, mode: null, bucket: null, dedupeKey: null
    };
    updateLikeUI(k);
    updateDeleteUI(k);
  });

  if (metaAll) metaAll.textContent = "地点を選んでください";
}

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
  renderConclusionCard({ pops: state.pops, isCached: !!state.isCachedResult });

  let renderedSlotCount = 0;
  const setSlot = (slotKey, value, label) => {
    const popEl = document.getElementById(`pop_${slotKey}`);
    const metaEl = document.getElementById(`meta_${slotKey}`);

    if (value == null) {
      if (popEl) popEl.textContent = "--%";
      if (metaEl) metaEl.textContent = "データなし";
      setIcon(slotKey, null);

      state.currentPhrases[slotKey] = {
        text: null, source: null, id: null, penName: null,
        likesToday: 0, totalLikes: 0, hof: false, mode: null, bucket: null, dedupeKey: null
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

    for (let i = 0; i < 5 && picked?.text && isNgText(picked.text); i++) {
      picked = pickMetaphor(mode, rounded);
    }

    if (picked?.text && isNgText(picked.text)) {
      picked = {
        text: "（非表示ワードが含まれるため表示できません）",
        source: null,
        id: null,
        penName: null,
        totalLikes: 0,
        hof: false,
        bucket: rounded,
        mode,
        dedupeKey: null
      };
    }

    try {
      const mbKey = keyMB(mode, rounded);
      const pubArr = publicCache.get(mbKey);

      if (Array.isArray(pubArr) && pubArr.length && picked?.text) {
        const canon = normalizeMetaphorText(picked.text);
        const hit = pubArr.find(it => normalizeMetaphorText(it?.text || "") === canon);

        if (hit) {
          picked = {
          ...picked,
          source: "public",
          id: String(hit.id || picked.id || "").trim() || null,
          penName: (hit.penName != null ? String(hit.penName).trim() : picked.penName),
          totalLikes: Math.max(Number(picked.totalLikes || 0), Number(hit.totalLikes || 0)),
          hof: !!picked.hof || !!hit.hof,
          dedupeKey: makeMetaphorDedupeKey({ mode, bucket: rounded, text: hit.text || picked.text })
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

    const nextTotalLikesRaw = (prevId && nextId && prevId === nextId)
  ? Number(state.currentPhrases[slotKey]?.totalLikes || totalLikesPicked || 0)
  : Number(totalLikesPicked || 0);

const nextTotalLikes = resolveDisplayTotalLikes(
  mode,
  rounded,
  picked.text,
  nextTotalLikesRaw
);

    state.currentPhrases[slotKey] = {
      text: picked.text,
      source: picked.source || null,
      id: nextId,
      penName: displayPen,
      likesToday: nextLikesToday,
      totalLikes: nextTotalLikes,
      hof: hofPicked,
      mode,
      bucket: rounded,
      dedupeKey: picked.dedupeKey || makeMetaphorDedupeKey({ mode, bucket: rounded, text: picked.text || "" })
    };

    updateLikeUI(slotKey);
    updateDeleteUI(slotKey);

    try { applyTheme(rounded); } catch {}
    renderedSlotCount += 1;

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
  const finalShown = candidates.filter(x => !!x?.text).length;
  try{
    console.log(
      `[debug] renderCounts slotsRendered=${renderedSlotCount} finalShown=${finalShown} ` +
      `mode=${getSelectedMode()}`
    );
  }catch{}

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
const GEO_CACHE_KEY = "geo_cache_v1";
const GEO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function loadGeoCache(){
  try { return JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || "{}"); }
  catch { return {}; }
}
function saveGeoCache(obj){
  try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(obj)); } catch {}
}
function geoKey(name){
  return String(name || "").trim().toLowerCase();
}

async function geocode(name) {
  const key = geoKey(name);
  const cache = loadGeoCache();
  const hit = cache[key];
  const now = Date.now();

  if (hit && hit.ts && (now - hit.ts) < GEO_CACHE_TTL_MS && hit.data) {
    return hit.data;
  }

  const url = new URL(GEO);
  url.searchParams.set("name", name);
  url.searchParams.set("count", "5");
  url.searchParams.set("language", "ja");
  url.searchParams.set("format", "json");

  let data = null;
  try{
    const res = await fetchWithTimeout(url.toString(), 3500);
    if (!res.ok) throw new Error(`geo_http_${res.status}`);
    data = await res.json();
  }catch(_e){
    const proxyUrl = new URL(`${API_BASE}/api/geocode`);
    proxyUrl.searchParams.set("q", name);
    proxyUrl.searchParams.set("count", "5");
    proxyUrl.searchParams.set("lang", "ja");
    const proxyRes = await fetchWithTimeout(proxyUrl.toString(), 4500);
    if (!proxyRes.ok) throw new Error("地点検索に失敗しました");
    data = await proxyRes.json();
  }

  cache[key] = { ts: now, data };
  saveGeoCache(cache);
  return data;
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

function applyWeatherStateFromPayload(payload, sourceLabel = "保存データ"){
  if (!payload?.pops) return false;
  state.selectedLat = Number(payload?.lat ?? state.selectedLat ?? 0);
  state.selectedLon = Number(payload?.lon ?? state.selectedLon ?? 0);
  state.placeLabel = String(payload?.placeLabel || state.placeLabel || "");
  state.pops = payload.pops;
  state.tz = payload?.tz || null;
  state.source = sourceLabel;
  state.isCachedResult = true;
  return true;
}
// =========================
// ✅ ランキングDOM
// =========================
function ensureRankingDom(){
  let wrap = document.getElementById("todayRankingWrap");
  if (!wrap) {
    const refreshBtn = document.getElementById("refresh");
    if (!refreshBtn) return;

    wrap = document.createElement("div");
    wrap.id = "todayRankingWrap";
    wrap.style.marginTop = "14px";
    wrap.innerHTML = `
      <div id="rankStatus">更新中…</div>
      <div class="rankBody" id="rankBody"></div>
    `;
    refreshBtn.insertAdjacentElement("afterend", wrap);
  }

  if (!document.getElementById("rankStatus")) {
    const st = document.createElement("div");
    st.id = "rankStatus";
    st.textContent = "更新中…";
    wrap.prepend(st);
  }
  if (!document.getElementById("rankBody")) {
    const body = document.createElement("div");
    body.className = "rankBody";
    body.id = "rankBody";
    wrap.appendChild(body);
  }
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

function makeRankingKey({ mode }){
  const mv = String(mode || "").trim();
  const m = (mv === "fun" || mv === "お笑い") ? "fun" : "trivia";
  return `${m}`;
}

function invalidateRanking(){
  __rankingRenderedKey = null;
}

function getRankingKeyNow(){
  const mode = getSelectedMode();
  if (!mode) return null;
  return makeRankingKey({ mode });
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
// ✅ FIX: 古いレスポンスで上書きしない
// ✅ FIX: 更新中でも今の内容は消さない
// ✅ SPEED: 段階表示
// =========================
async function renderRanking(){
  try{
    ensureRankingDom();
    const wrap = document.getElementById("todayRankingWrap");
    const rankBody = document.getElementById("rankBody");
    if (!wrap || !rankBody) return;

    const reqId = ++__rankingReqSeq;
    setRankingBusy(true);

    const mode = getSelectedMode();
    const hofTh = Number(state.hofThreshold || 20);
    const latestOpen = loadLatestOpen();

    rankBody.innerHTML = `
      <div id="rankTodayCard" class="card" style="margin:0 0 10px 0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
        <div class="muted">今日のランキングを読み込み中…</div>
      </div>

      <div id="rankHofCard" class="card" style="margin:0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
        <div class="muted">殿堂入りを読み込み中…</div>
      </div>
    `;

    

    const todayPromise = (async () => {
      try{
        const rankingRaw = (await fetchRankingTodayAll(mode, 20))
          .map(it => ({
            ...it,
            mode,
            bucket: Number.isFinite(Number(it?.bucket)) ? Number(it.bucket) : 0,
            text: String(it?.text || "").trim(),
            penName: it?.penName ? String(it.penName).trim() : null,
            likes: Number(it?.likes || 0),
            source: "public"
          }))
          .filter(it => it.text)
          .filter(it => !isNgText(it?.text));

        const items = mergeDisplayItems(rankingRaw, { mode })
          .sort((a, b) => Number(b.likes || 0) - Number(a.likes || 0))
          .slice(0, 3);

        if (!items.length) {
          return `
            <div id="rankTodayCard" class="card" style="margin:0 0 10px 0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
              <div style="font-weight:900; font-size:16px; margin-bottom:6px;">今日のランキング TOP3（全バケット共通 / ${mode==="fun"?"お笑い":"雑学"}）</div>
              <div class="muted" style="margin-bottom:8px;">※今日(JST)のいいね数で集計（0〜100%まとめて）</div>
              <div class="muted">まだランキングがありません（今日の👍が0件）</div>
            </div>
          `;
        }

        const rows = items.map((it, idx) => {
          const pen = penHtmlIfAny(it.penName);
          return `
            <div style="padding:10px 0; border-top:1px solid rgba(15,23,42,0.10);">
              <div style="font-weight:800;">${idx+1}位：${escapeHtml(it.text)}${pen}${modeBadgeHtml(mode)}</div>
              <div class="muted">今日の👍：${Number(it.likes||0)}</div>
            </div>
          `;
        }).join("");

        return `
          <div id="rankTodayCard" class="card" style="margin:0 0 10px 0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
            <div style="font-weight:900; font-size:16px; margin-bottom:6px;">今日のランキング TOP3（全バケット共通 / ${mode==="fun"?"お笑い":"雑学"}）</div>
            <div class="muted" style="margin-bottom:8px;">※今日(JST)のいいね数で集計（0〜100%まとめて）</div>
            <div>${rows}</div>
          </div>
        `;
      } catch (e) {
        return `
          <div id="rankTodayCard" class="card" style="margin:0 0 10px 0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
            <div style="font-weight:900; font-size:16px; margin-bottom:6px;">今日のランキング TOP3（全バケット共通 / ${mode==="fun"?"お笑い":"雑学"}）</div>
            <div class="muted" style="margin-bottom:8px;">※今日(JST)のいいね数で集計（0〜100%まとめて）</div>
            <div class="muted">総合ランキング取得に失敗：${escapeHtml(String(e?.message || e))}</div>
          </div>
        `;
      }
    })();

    const hofPromise = (async () => {
      try{
        await ensureHallSnapshotLoaded();
        return __hofSnapshotHtml || `
          <div id="rankHofCard" class="card" style="margin:0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
            <div class="muted">殿堂入りデータなし</div>
          </div>
        `;
      } catch (e) {
        return `
          <div id="rankHofCard" class="card" style="margin:0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
            <div style="font-weight:900; font-size:16px; margin-bottom:6px;">殿堂入り（全モード共通）</div>
            <div class="muted">殿堂入り取得に失敗：${escapeHtml(String(e?.message || e))}</div>
          </div>
        `;
      }
    })();

    
    todayPromise.then((html) => {
      if (reqId !== __rankingReqSeq) return;
      const el = document.getElementById("rankTodayCard");
      if (el) el.outerHTML = html;
    });

    hofPromise.then((html) => {
      if (reqId !== __rankingReqSeq) return;
      const el = document.getElementById("rankHofCard");
      if (el) el.outerHTML = html;
    });

    await Promise.allSettled([todayPromise, hofPromise]);

  } catch(e){
    console.warn("renderRanking error", e);
  } finally {
    setRankingBusy(false);
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

    setSearchBusy(true);
    setLoadingStep("現在地を確認中…");
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
        const mySeq = ++__searchSeq;

        const opt = sel.options[sel.selectedIndex];
        const lat = Number(opt.dataset.lat);
        const lon = Number(opt.dataset.lon);

        state.selectedLat = lat;
        state.selectedLon = lon;
        state.placeLabel = opt.textContent;
        state.source = "API: Open-Meteo";

        const modeNow = getSelectedMode();
        const sig = `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}|${modeNow}`;
        if (__lastWeatherFetchSig === sig && (Date.now() - __lastWeatherFetchAt) < SAME_SEARCH_SUPPRESS_MS) {
          setStatus("同じ地点の再取得を少し待ってから実行します", "muted");
          setSearchBusy(false);
          setRankingBusy(false);
          return;
        }
        __lastWeatherFetchSig = sig;
        __lastWeatherFetchAt = Date.now();

        invalidateRanking();
        setRankingBusy(true);
        setSearchBusy(true);
        setLoadingStep("天気を取得中…");
        setStatus("天気取得中…", "muted");

        const wxCacheBeforeClear = loadWxCache()[wxKey(lat, lon)] || null;

try {
  clearWxCacheByLatLon(lat, lon);

  const out = await fetchPopsBySlotsNetwork(lat, lon, 4500);

  if (mySeq !== __searchSeq) return;

  const nextPops = out.pops;
  const nextTz = out.tz;

          const mode = getSelectedMode();
          const buckets = uniqueBucketsFromPops(nextPops);
          Promise.all(buckets.map(b => warmPublicCache(mode, b))).catch(() => {});

          if (mySeq !== __searchSeq) return;

          state.pops = nextPops;
          state.tz = nextTz;
          state.isCachedResult = false;

          const any = (state.pops.m != null) || (state.pops.d != null) || (state.pops.e != null);
          if (!any) {
            setStatus("降水確率が取得できませんでした（別地点で試してください）", "ng");
            state.source = "API: 取得失敗";
            state.pops = null;
            scheduleRender();
            return;
          }

          setLoadingStep("天気を取得しました");
          __freezeMetaphor = false;
          window.__forceRepick = true;
          scheduleRender();
          requestAnimationFrame(() => {
            window.__forceRepick = false;
          });

          setStatus("取得しました", "ok");
          saveLastSuccessWeather({
            lat,
            lon,
            placeLabel: state.placeLabel,
            pops: state.pops,
            tz: state.tz
          });

          try{ pingUsageOncePerDay("dau_ping"); }catch{}
          try{ await pingWeatherSearchSuccess(); }catch{}
          try { fireIfApprovedOnNextSearch(); } catch {}

          setLoadingStep("ネタを準備中…");

          try{
        const key = getRankingKeyNow();
        setLoadingStep("ランキングを準備中…");
        renderRankingOnce(key).catch(e => {
        console.warn("renderRankingOnce(after search) failed", e);
        });
        }catch(e){
        console.warn("renderRankingOnce(after search) failed", e);
        }

        } catch (e) {
  if (mySeq !== __searchSeq) return;

   const cacheAgeMs = Date.now() - Number(wxCacheBeforeClear?.ts || 0);
   const canUseFallbackCache =
     !!wxCacheBeforeClear?.pops &&
     Number.isFinite(cacheAgeMs) &&
     cacheAgeMs <= WX_FALLBACK_MAX_STALE_MS;

   if (canUseFallbackCache) {
    const mode = getSelectedMode();
    const buckets = uniqueBucketsFromPops(wxCacheBeforeClear.pops);
    Promise.all(buckets.map(b => warmPublicCache(mode, b))).catch(() => {});

    if (mySeq !== __searchSeq) return;

    state.pops = wxCacheBeforeClear.pops;
    state.tz = wxCacheBeforeClear.tz || null;
    state.source = "API: キャッシュ(通信失敗時のみ)";
    state.isCachedResult = true;

    __freezeMetaphor = false;
    window.__forceRepick = true;
    scheduleRender();
    requestAnimationFrame(() => {
      window.__forceRepick = false;
    });

    setStatus("取得に失敗しました。前回結果があれば表示しています。", "ng");
    setLoadingStep("取得に失敗しました。前回結果があれば表示しています。");

    try{
      const key = getRankingKeyNow();
      renderRankingOnce(key).catch(err => {
        console.warn("renderRankingOnce(cache fallback) failed", err);
      });
    }catch(err){
      console.warn("renderRankingOnce(cache fallback) failed", err);
    }

    return;
  }

  if (wxCacheBeforeClear?.pops) {
    setStatus("最新取得に失敗（保存データが古いため非表示）", "ng");
  } else {
    setStatus(e.message || "天気取得エラー", "ng");
  }
  state.source = "API: エラー";
  state.pops = null;
  state.isCachedResult = false;
  setLoadingStep("取得に失敗しました。前回結果があれば表示しています。");
  scheduleRender();
} finally {
          if (mySeq === __searchSeq) {
            setLoadingStep("更新完了");
            setTimeout(() => setSearchBusy(false), 600);
            setRankingBusy(false);
          }
        }
      };

      sel.selectedIndex = 0;
      await sel.onchange();

    } catch (e) {
      setStatus(e.message || "検索エラー", "ng");
    } finally {
      setSearchBusy(false);
    }
  };
})();

// =========================
// mode 切替（ランキング更新）
// =========================
document.querySelectorAll('input[name="mode"]').forEach(r =>
  r.addEventListener("change", async () => {
    invalidateRanking();

    if (!state?.pops) {
      __freezeMetaphor = false;
      window.__forceRepick = true;
      scheduleRender();
      requestAnimationFrame(() => {
        window.__forceRepick = false;
      });
      return;
    }

    try{
      setRankingBusy(true);

      const mode = getSelectedMode();
      const buckets = uniqueBucketsFromPops(state.pops);
      Promise.all(buckets.map(b => warmPublicCache(mode, b))).catch(() => {});

      __freezeMetaphor = false;
      window.__forceRepick = true;
      scheduleRender();
      requestAnimationFrame(() => {
        window.__forceRepick = false;
      });

      const key = getRankingKeyNow();
      await renderRankingOnce(key);
    }catch(e){
      console.warn("renderRankingOnce(on mode change) failed", e);
    }finally{
      setRankingBusy(false);
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
  await clearOldAppCachesOnBuildChange();
  try {
    const last = loadLastSuccessWeather();
    if (applyWeatherStateFromPayload(last, "前回の結果です")) {
      setStatus("前回の結果です。更新中…", "muted");
      scheduleRender();
      setTimeout(async () => {
        try{
          if (!Number.isFinite(Number(last?.lat)) || !Number.isFinite(Number(last?.lon))) return;
          const out = await fetchPopsBySlotsNetwork(Number(last.lat), Number(last.lon), 4500);
          state.pops = out.pops;
          state.tz = out.tz || null;
          state.source = "API: Open-Meteo";
          state.isCachedResult = false;
          const mode = getSelectedMode();
          uniqueBucketsFromPops(state.pops).forEach(b => { warmPublicCache(mode, b).catch(()=>{}); });
          saveLastSuccessWeather({ lat: Number(last.lat), lon: Number(last.lon), placeLabel: state.placeLabel, pops: state.pops, tz: state.tz });
          scheduleRender();
          setStatus("最新データに更新しました", "ok");
          const key = getRankingKeyNow();
          if (key) setTimeout(() => { renderRankingOnce(key).catch(()=>{}); }, 150);
        }catch(e){
          state.isCachedResult = true;
          setStatus("取得に失敗しました。前回結果があれば表示しています。", "ng");
        }
      }, 0);
    }
  } catch {}
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
