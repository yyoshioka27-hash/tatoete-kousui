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
const BUILD = "2026-03-23_hof_mixed_daily_cache__SCRIPT_FULL_v12";

// ✅ API_BASE（/api/health がOKの“正”）
const API_BASE = "https://ancient-union-4aa4tatoete-kousui-api.y-yoshioka27.workers.dev";

// ✅ 殿堂入り日次スナップショット（GitHub Pages側に1日1回だけ配置）
const HOF_DAILY_JSON_URL = "./hall_of_fame_daily.json";
const HOF_DAILY_CACHE_KEY = "hof_daily_cache_v2";
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
        totalLikes: Number(raw?.totalLikes || 0),
        likes: Number(raw?.likes || 0),
        hof: !!raw?.hof,
        __dedupeKey: key,
        __canonText: normalizeMetaphorText(text),
      });
      continue;
    }

    const keepIncoming = sourcePriority(raw?.source) > sourcePriority(current?.source);

    current.text = pickBetterText(current.text, text);
    current.penName = pickBetterPenName(current.penName, raw?.penName);
    current.totalLikes = Math.max(Number(current.totalLikes || 0), Number(raw?.totalLikes || 0));
    current.likes = Math.max(Number(current.likes || 0), Number(raw?.likes || 0));
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
  const deduped = mergeDisplayItems(
    items
      .map(it => ({
        id: String(it.id || "").trim(),
        text: String(it.text || "").trim(),
        penName: (it.penName ? String(it.penName).trim() : null),
        totalLikes: Number(it.totalLikes || 0),
        likes: Number(it.likes || 0),
        hof: !!it.hof,
        source: "public",
        mode: (mode === "fun" ? "fun" : "trivia"),
        bucket: window.bucket10(Number(bucket))
      }))
      .filter(x => x.id && x.text)
      .filter(x => !isNgText(x.text)),
    { mode, bucket }
  );

  return deduped.map(x => ({
    id: x.id,
    text: x.text,
    penName: x.penName || null,
    totalLikes: Number(x.totalLikes || 0),
    hof: !!x.hof
  }));
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
      source: "public"
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

// ✅ 殿堂入り（従来API / フォールバック用）
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
    totalLikes: Number(raw?.totalLikes || 0),
    likes: Number(raw?.likes || 0),
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

  const merged = [
    ...a.map(it => ({
      ...it,
      mode: (it?.mode === "fun" ? "fun" : "trivia")
    })),
    ...t.map(it => ({
      ...it,
      mode: "trivia"
    })),
    ...f.map(it => ({
      ...it,
      mode: "fun"
    })),
  ];

  return mergeDisplayItems(
    merged
      .map(normalizeHallSnapshotItem)
      .filter(Boolean)
      .filter(it => !isNgText(it.text))
  ).sort((x, y) => Number(y.totalLikes || 0) - Number(x.totalLikes || 0));
}

function hasHallMode(items, mode){
  const m = (mode === "fun" ? "fun" : "trivia");
  return (Array.isArray(items) ? items : []).some(it => (it?.mode === "fun" ? "fun" : "trivia") === m);
}

async function fetchHallModeFromApiOncePerDay(mode, limit = 20){
  const arr = await fetchHallOfFame(mode, 0, limit);
  return mergeDisplayItems(
    (Array.isArray(arr) ? arr : [])
      .map(it => normalizeHallSnapshotItem({
        ...it,
        mode: (mode === "fun" ? "fun" : "trivia"),
        bucket: Number.isFinite(Number(it?.bucket)) ? Number(it.bucket) : 0,
        totalLikes: Number(it?.totalLikes || 0),
        likes: Number(it?.likes || 0),
        penName: it?.penName ? String(it.penName).trim() : null,
        text: String(it?.text || "").trim()
      }))
      .filter(Boolean)
      .filter(it => !isNgText(it.text))
  ).sort((x, y) => Number(y.totalLikes || 0) - Number(x.totalLikes || 0));
}

function loadHallDailyCache(){
  try{
    return JSON.parse(localStorage.getItem(HOF_DAILY_CACHE_KEY) || "null");
  }catch{
    return null;
  }
}

function saveHallDailyCache(payload){
  try{
    localStorage.setItem(HOF_DAILY_CACHE_KEY, JSON.stringify(payload));
  }catch{}
}

async function fetchHallOfFameDaily(limit = 20){
  const today = todayJSTString();
  const cached = loadHallDailyCache();

  if (cached?.day === today && Array.isArray(cached?.items) && cached.items.length){
    if (cached?.hofThreshold != null) {
      state.hofThreshold = Number(cached.hofThreshold || state.hofThreshold || 20);
    }
    const cachedItems = mergeDisplayItems(
      cached.items
        .map(normalizeHallSnapshotItem)
        .filter(Boolean)
        .filter(it => !isNgText(it.text))
    ).sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));

    return {
      generatedAt: cached.generatedAt || null,
      hofThreshold: Number(cached.hofThreshold || state.hofThreshold || 20),
      items: cachedItems.slice(0, limit)
    };
  }

  const url = `${HOF_DAILY_JSON_URL}?d=${encodeURIComponent(today)}`;
  const res = await fetch(url, { method:"GET", cache:"default" });
  const data = await res.json().catch(()=>null);

  if (!res.ok || !data) {
    throw new Error(`hof daily json failed ${res.status}`);
  }

  let items = extractHallSnapshotItemsFromPayload(data);
  const needTrivia = !hasHallMode(items, "trivia");
  const needFun = !hasHallMode(items, "fun");

  if (needTrivia || needFun){
    const fills = await Promise.all([
      needTrivia ? fetchHallModeFromApiOncePerDay("trivia", limit) : Promise.resolve([]),
      needFun    ? fetchHallModeFromApiOncePerDay("fun", limit)    : Promise.resolve([]),
    ]);

    items = mergeDisplayItems([
      ...items,
      ...fills[0],
      ...fills[1]
    ]).sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));
  }

  const hofThreshold = Number(data?.hofThreshold || state.hofThreshold || 20);
  state.hofThreshold = hofThreshold;

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

async function fetchHallOfFameForRanking(limit = 20){
  try{
    return await fetchHallOfFameDaily(limit);
  }catch(e){
    console.warn("hof daily snapshot failed, fallback to api/hof", e?.message || e);

    const [tItems, fItems] = await Promise.all([
      fetchHallOfFame("trivia", 0, limit),
      fetchHallOfFame("fun",    0, limit),
    ]);

    const merged =

            mergeDisplayItems([
        ...(Array.isArray(tItems) ? tItems : []).map(it => ({
          ...it,
          mode: "trivia",
          source: "public"
        })),
        ...(Array.isArray(fItems) ? fItems : []).map(it => ({
          ...it,
          mode: "fun",
          source: "public"
        })),
      ])
      .map(normalizeHallSnapshotItem)
      .filter(Boolean)
      .filter(it => !isNgText(it.text))
      .sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));

    return {
      generatedAt: null,
      hofThreshold: Number(state.hofThreshold || 20),
      items: merged.slice(0, limit)
    };
  }
}

// ✅ HOFスナップショットをメモリに載せる（重複fetch防止）
let __hofSnapshotPromise = null;
async function ensureHallSnapshotLoaded(){
  const today = todayJSTString();

  if (__hofSnapshotMemory?.day === today && Array.isArray(__hofSnapshotMemory?.items)) {
    return __hofSnapshotMemory;
  }
  if (__hofSnapshotPromise) return __hofSnapshotPromise;

  __hofSnapshotPromise = (async () => {
    const snap = await fetchHallOfFameForRanking(20);
    __hofSnapshotMemory = {
      day: today,
      generatedAt: snap?.generatedAt || null,
      hofThreshold: Number(snap?.hofThreshold || state.hofThreshold || 20),
      items: Array.isArray(snap?.items) ? snap.items : []
    };
    return __hofSnapshotMemory;
  })();

  try{
    return await __hofSnapshotPromise;
  } finally {
    __hofSnapshotPromise = null;
  }
}

// ==============================
// ユーティリティ
// ==============================
window.bucket10 = function bucket10(n){
  const x = Math.max(0, Math.min(100, Math.round(Number(n))));
  return Math.round(x / 10) * 10;
};

function normalizeForCompare(str){
  return String(str || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/[。．、,，!！?？]+$/g, "")
    .trim()
    .toLowerCase();
}

function stableHash(str){
  const s = String(str || "");
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function makeGlobalId({ mode, bucket, text, source = "base" }){
  const m = (mode === "fun" ? "fun" : "trivia");
  const b = Number.isFinite(Number(bucket)) ? window.bucket10(Number(bucket)) : 0;
  const t = normalizeForCompare(text);
  return `${source}:${m}:${b}:${stableHash(t)}`;
}

function looksLikeGlobalId(v){
  return typeof v === "string" && /^[a-z_]+:(trivia|fun):\d+:[a-z0-9]+$/i.test(v);
}

function ensureGlobalItemId(item, fallbackSource = "base"){
  const id = String(item?.id || "").trim();
  if (looksLikeGlobalId(id)) return id;

  if (id && !/^[a-z_]+:(trivia|fun):\d+:[a-z0-9]+$/i.test(id) && item?.source === "public"){
    return id;
  }

  return makeGlobalId({
    mode: item?.mode,
    bucket: item?.bucket,
    text: item?.text,
    source: item?.source || fallbackSource
  });
}

function uniqBy(arr, keyFn){
  const seen = new Set();
  const out = [];
  for (const x of (arr || [])){
    const k = keyFn(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

// ==============================
// ベースネタ（metaphors.js想定）
// - window.METAPHORS = { trivia: {0:[...],10:[...]}, fun:{...} }
// ==============================
window.METAPHORS = window.METAPHORS || { trivia:{}, fun:{} };

// ✅ canonical base map
const BASE_CANON = { trivia:{}, fun:{} };

function normalizeBaseMetaphors(){
  ["trivia","fun"].forEach(mode => {
    const src = window.METAPHORS?.[mode] || {};
    const dst = {};
    for (let b = 0; b <= 100; b += 10){
      const arr = Array.isArray(src[b]) ? src[b] : [];
      dst[b] = uniqBy(
        arr
          .map(text => ({
            id: makeGlobalId({ mode, bucket: b, text, source: "base" }),
            text: String(text || "").trim(),
            mode,
            bucket: b,
            source: "base"
          }))
          .filter(x => x.text)
          .filter(x => !isNgText(x.text))
          .filter(x => !hasMismatchedPercent(x.text, b))
          .filter(x => !hasHard100PercentMismatch(x.text, b)),
        x => makeMetaphorDedupeKey(x)
      ).map(x => x.text);
    }
    BASE_CANON[mode] = dst;
  });
}
normalizeBaseMetaphors();

// ==============================
// 今日の天気（Open-Meteo）
// ==============================
const WMO_JA = {
  0:"快晴", 1:"晴れ", 2:"薄曇り", 3:"くもり",
  45:"霧", 48:"着氷性の霧",
  51:"弱い霧雨", 53:"霧雨", 55:"強い霧雨",
  61:"弱い雨", 63:"雨", 65:"強い雨",
  66:"着氷性の弱い雨", 67:"着氷性の強い雨",
  71:"弱い雪", 73:"雪", 75:"大雪",
  77:"雪粒", 80:"弱いにわか雨", 81:"にわか雨", 82:"激しいにわか雨",
  85:"弱いにわか雪", 86:"にわか雪",
  95:"雷雨", 96:"雷雨(弱い雹)", 99:"雷雨(強い雹)"
};

async function geocodePlace(name){
  const q = encodeURIComponent(name);
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=ja&format=json`;
  const res = await fetch(url, { cache:"no-store" });
  if(!res.ok) throw new Error("地名検索に失敗しました");
  const data = await res.json();
  const hit = data?.results?.[0];
  if(!hit) throw new Error("場所が見つかりませんでした");
  return {
    name: [hit.name, hit.admin1, hit.country].filter(Boolean).join(", "),
    latitude: hit.latitude,
    longitude: hit.longitude
  };
}

async function fetchWeather(lat, lon){
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&daily=precipitation_probability_max,weathercode,temperature_2m_max,temperature_2m_min` +
    `&timezone=Asia%2FTokyo&forecast_days=1`;
  const res = await fetch(url, { cache:"no-store" });
  if(!res.ok) throw new Error("天気取得に失敗しました");
  const data = await res.json();
  const p = data?.daily?.precipitation_probability_max?.[0];
  const code = data?.daily?.weathercode?.[0];
  const tmax = data?.daily?.temperature_2m_max?.[0];
  const tmin = data?.daily?.temperature_2m_min?.[0];
  return {
    precipProb: Number.isFinite(p) ? p : 0,
    weatherCode: code,
    weatherLabel: WMO_JA[code] ?? "不明",
    tmax, tmin
  };
}

// ==============================
// 場所ごとの最新結果を保持
// ==============================
const weatherCache = new Map();

// ==============================
// 状態
// ==============================
const state = {
  mode: "trivia",
  bucket: null,
  lastPlaceKey: "",
  lastPlaceLabel: "",
  currentText: "",
  currentId: null,
  currentSource: "base",
  publicByBucket: {},
  publicLoadedAt: {},
  rankingTodayTop3: [],
  rankingTotalTop3: [],
  latestPublicTop10: [],
  hofTop: [],
  hofThreshold: 20,
  totalUsers: null,
  __allForCurrentBucket: []
};

// ==============================
// place保存キー
// ==============================
const LAST_PLACE_KEY = "last_place_v1";
function saveLastPlace(name){
  try{
    localStorage.setItem(LAST_PLACE_KEY, String(name || "").trim());
  }catch{}
}
function loadLastPlace(){
  try{
    return localStorage.getItem(LAST_PLACE_KEY) || "";
  }catch{
    return "";
  }
}

// ==============================
// 運営メモ（外出し）読み込み
// ==============================
let __notesLoaded = false;

async function loadNoteBanners(){
  if (__notesLoaded) return;
  __notesLoaded = true;

  try{
    const res = await fetch("./notes.json?ts=20260319a", { cache: "no-store" });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) return;

    const up = document.getElementById("updateBanner");
    if (up && data.updateBanner && String(data.updateBanner).trim()){
      up.innerHTML = String(data.updateBanner);
      up.style.display = "";
    }

    const mg = document.getElementById("managerNote");
    if (mg && data.managerNote && String(data.managerNote).trim()){
      mg.innerHTML = String(data.managerNote);
      mg.style.display = "";
    }
  }catch(e){
    console.warn("notes.json load skipped", e);
  }
}

// ==============================
// 最新ネタ欄の初期雛形
// ==============================
(function ensureLatestPublicDom(){
  if (document.getElementById("latestPublic")) return;

  const rank = document.getElementById("todayRankingWrap");
  if (!rank || !rank.parentElement) return;

  const box = document.createElement("div");
  box.id = "latestPublicWrap";
  box.className = "card";
  box.style.maxWidth = "820px";
  box.style.margin = "16px auto 0 auto";
  box.innerHTML = `
    <h3 style="margin-top:0;">最新の採用ネタ <span class="muted" style="font-size:12px;">（直近10件）</span></h3>
    <div id="latestPublic" class="small muted">まだありません</div>
  `;
  rank.parentElement.insertBefore(box, rank);
})();

// ==============================
// ✅ 24時間単位キャッシュ（public）
// ==============================
const PUBLIC_CACHE_PREFIX = "public_cache_v3_";
const PUBLIC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function publicCacheKey(mode, bucket){
  return `${PUBLIC_CACHE_PREFIX}${mode}_${window.bucket10(bucket)}`;
}
function loadPublicCache(mode, bucket){
  try{
    const raw = localStorage.getItem(publicCacheKey(mode, bucket));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !Array.isArray(obj.items)) return null;
    if ((Date.now() - Number(obj.savedAt || 0)) > PUBLIC_CACHE_TTL_MS) return null;
    return obj.items;
  }catch{
    return null;
  }
}
function savePublicCache(mode, bucket, items){
  try{
    localStorage.setItem(publicCacheKey(mode, bucket), JSON.stringify({
      savedAt: Date.now(),
      items: Array.isArray(items) ? items : []
    }));
  }catch{}
}

// ==============================
// ✅ 総ユーザー数取得
// ==============================
let __usersCache = { value: null, at: 0 };
async function fetchTotalUsersCached(force = false){
  try{
    const now = Date.now();
    if (!force && __usersCache.value != null && (now - __usersCache.at) < 5 * 60 * 1000){
      return __usersCache.value;
    }
    const res = await fetch(`${API_BASE}/api/usage/stats`, { cache:"no-store" });
    const data = await res.json().catch(()=>null);
    if (!res.ok || !data?.ok) throw new Error(`usage stats failed ${res.status}`);
    const v = Number(data.totalUsers || 0);
    __usersCache = { value: v, at: now };
    return v;
  }catch(e){
    console.warn("fetchTotalUsersCached failed", e?.message || e);
    return null;
  }
}

// ==============================
// ✅ 殿堂入りを先に文字列化しておく（体感高速化）
// ==============================
function buildHallHtmlItems(hofItems, currentMode){
  const arr = Array.isArray(hofItems) ? hofItems : [];
  if (!arr.length) return `<div class="small muted">殿堂入りはまだありません</div>`;

  return `
    <ol style="margin:8px 0 0 1.2em; padding:0;">
      ${arr.slice(0, 20).map(it => {
        const id = ensureGlobalItemId({ ...it, source: it?.source || "hof_daily" }, "hof_daily");
        const likes = Number(it.totalLikes || it.likes || 0);
        const pen = penHtmlIfAny(it.penName);
        const isCurrent = (String(state.currentId || "") === String(id));
        const liked = isCurrent && Number(state.currentLikes || 0) > 0;
        const btnLabel = liked ? "❤️ いいね済み" : "🤍 いいね";
        const likeDisabled = liked ? "disabled" : "";
        const itemMode = (it.mode === "fun" ? "fun" : "trivia");

        return `
          <li style="margin:8px 0;">
            <div>
              <strong>${escapeHtml(it.text)}</strong>${pen}${modeBadgeHtml(itemMode)}
              <div class="small muted">累計いいね ${likes}</div>
              <div style="margin-top:6px;">
                <button
                  class="like-btn-pop"
                  data-like-id="${escapeHtml(id)}"
                  data-like-mode="${escapeHtml(itemMode)}"
                  data-like-bucket="${escapeHtml(String(it.bucket || 0))}"
                  data-like-text="${escapeHtml(it.text)}"
                  ${likeDisabled}
                  style="
                    border:none;border-radius:999px;padding:8px 12px;
                    font-weight:900;cursor:pointer;
                    background:${liked ? "rgba(239,68,68,.12)" : "rgba(15,23,42,.06)"};
                  "
                >${btnLabel}</button>
              </div>
            </div>
          </li>
        `;
      }).join("")}
    </ol>
  `;
}

function refreshHallHtmlCache(){
  try{
    __hofSnapshotHtml = buildHallHtmlItems(state.hofTop || [], state.mode);
  }catch(e){
    console.warn("refreshHallHtmlCache error", e);
    __hofSnapshotHtml = null;
  }
}

// ==============================
// レンダリング
// ==============================
function renderCurrentCard(text, bucket){
  const card = document.getElementById("result");
  if (!card) return;

  const isFun = state.mode === "fun";
  const bg = isFun
    ? "linear-gradient(135deg, rgba(240,253,244,.95), rgba(220,252,231,.95))"
    : "linear-gradient(135deg, rgba(239,246,255,.95), rgba(224,242,254,.95))";

  card.style.background = bg;

  const likeDisabled = state.currentLikes > 0 ? "disabled" : "";
  const likeLabel = state.currentLikes > 0 ? "❤️ いいね済み" : "🤍 いいね";
  const likeBg = state.currentLikes > 0 ? "rgba(239,68,68,.12)" : "rgba(15,23,42,.06)";
  const currentId = ensureGlobalItemId({
    id: state.currentId,
    mode: state.mode,
    bucket,
    text,
    source: state.currentSource || "base"
  }, state.currentSource || "base");

  card.innerHTML = `
    <div class="small muted" style="margin-bottom:6px;">
      降水確率 <strong>${bucket}%</strong> のたとえ
    </div>
    <div style="font-size:1.15rem; font-weight:900; line-height:1.6;">
      ${escapeHtml(text)}
    </div>
    <div style="margin-top:14px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
      <button id="copyBtn" class="ghost">コピー</button>
      <button id="shareXBtn" class="ghost">Xで共有</button>
      <button
        id="likeBtn"
        class="like-btn-pop"
        ${likeDisabled}
        style="border:none;border-radius:999px;padding:10px 14px;font-weight:900;cursor:pointer;background:${likeBg};"
      >${likeLabel}</button>
    </div>
  `;

  const copyBtn = document.getElementById("copyBtn");
  if (copyBtn) {
    copyBtn.onclick = async () => {
      const place = state.lastPlaceLabel || "";
      const header = place ? `【${place}】\n` : "";
      const body = `${header}今日の降水確率は ${bucket}%\n${text}\n#たとえて降水確率`;
      try{
        await navigator.clipboard.writeText(body);
        copyBtn.textContent = "コピーしました";
        setTimeout(() => { copyBtn.textContent = "コピー"; }, 1200);
      }catch{
        alert("コピーに失敗しました");
      }
    };
  }

  const shareXBtn = document.getElementById("shareXBtn");
  if (shareXBtn) {
    shareXBtn.onclick = () => {
      const place = state.lastPlaceLabel || "";
      const header = place ? `【${place}】\n` : "";
      const body = `${header}今日の降水確率は ${bucket}%\n${text}\n#たとえて降水確率`;
      const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(body)}`;
      window.open(url, "_blank", "noopener,noreferrer");
    };
  }

  const likeBtn = document.getElementById("likeBtn");
  if (likeBtn) {
    likeBtn.onclick = async () => {
      likeBtn.disabled = true;
      try{
        const data = await likeAny({
          itemId: currentId,
          mode: state.mode,
          bucket,
          text,
          source: state.currentSource || "base"
        });

        state.currentLikes = Number(data.totalLikes || 0);
        likeBtn.textContent = "❤️ いいね済み";
        likeBtn.style.background = "rgba(239,68,68,.12)";
        likeFxPop(likeBtn);
        likeFxPlusOne(likeBtn);

        const all = Array.isArray(state.__allForCurrentBucket) ? state.__allForCurrentBucket : [];
        const hit = all.find(x => String(ensureGlobalItemId({
          ...x,
          source: x?.source || state.currentSource || "base"
        }, x?.source || state.currentSource || "base")) === String(currentId));
        if (hit) {
          hit.totalLikes = Number(data.totalLikes || hit.totalLikes || 0);
          hit.hof = !!data.hof;
        }

        try{
          const pub = (state.publicByBucket?.[bucket] || []).find(x => String(x.id) === String(currentId));
          if (pub){
            pub.totalLikes = Number(data.totalLikes || pub.totalLikes || 0);
            pub.hof = !!data.hof;
            savePublicCache(state.mode, bucket, state.publicByBucket[bucket] || []);
          }
        }catch{}

        try{
          const hof = Array.isArray(state.hofTop) ? state.hofTop : [];
          const h = hof.find(x => String(ensureGlobalItemId({
            ...x,
            source: x?.source || "hof_daily"
          }, x?.source || "hof_daily")) === String(currentId));
          if (h){
            h.totalLikes = Number(data.totalLikes || h.totalLikes || 0);
            h.hof = !!data.hof;
            refreshHallHtmlCache();
          }
        }catch{}

        loadRankingIfNeeded(true).catch(console.warn);
      }catch(e){
        alert(`いいね失敗: ${e.message}`);
        likeBtn.disabled = false;
      }
    };
  }
}

function renderMeta(weather){
  const place = document.getElementById("placeLine");
  const meta = document.getElementById("weatherLine");
  if (!place || !meta) return;

  place.textContent = state.lastPlaceLabel ? `場所：${state.lastPlaceLabel}` : "";
  meta.innerHTML = `
    天気：<strong>${escapeHtml(weather.weatherLabel)}</strong> ／
    降水確率：<strong>${state.bucket}%</strong>
    ${
      Number.isFinite(weather.tmax) && Number.isFinite(weather.tmin)
        ? ` ／ 気温：<strong>${Math.round(weather.tmin)}〜${Math.round(weather.tmax)}℃</strong>`
        : ""
    }
  `;
}

function renderLatestPublic(){
  const el = document.getElementById("latestPublic");
  if (!el) return;

  const items = Array.isArray(state.latestPublicTop10) ? state.latestPublicTop10 : [];
  if (!items.length){
    el.innerHTML = `<div class="small muted">まだありません</div>`;
    return;
  }

  el.innerHTML = `
    <ol style="margin:8px 0 0 1.2em; padding:0;">
      ${items.map(it => `
        <li style="margin:8px 0;">
          <strong>${escapeHtml(it.text)}</strong>${penHtmlIfAny(it.penName)}${modeBadgeHtml(it.mode)}
          <div class="small muted">
            ${Number.isFinite(Number(it.bucket)) ? `${window.bucket10(it.bucket)}%` : ""}
          </div>
        </li>
      `).join("")}
    </ol>
  `;
}

function renderRanking(){
  const el = document.getElementById("todayRanking");
  if (!el) return;

  const today = Array.isArray(state.rankingTodayTop3) ? state.rankingTodayTop3 : [];
  const total = Array.isArray(state.rankingTotalTop3) ? state.rankingTotalTop3 : [];
  const hof = Array.isArray(state.hofTop) ? state.hofTop : [];

  const secToday = `
    <div class="card" style="max-width:820px;margin:0 auto 14px auto;">
      <h3 style="margin-top:0;">今日の人気ネタ TOP3 <span class="muted" style="font-size:12px;">（全体）</span></h3>
      ${
        today.length
          ? `<ol style="margin:8px 0 0 1.2em; padding:0;">
              ${today.map(x => `
                <li style="margin:8px 0;">
                  <strong>${escapeHtml(x.text || "")}</strong>${penHtmlIfAny(x.penName)}${modeBadgeHtml(x.mode)}
                  <div class="small muted">今日のいいね ${Number(x.likes || 0)}</div>
                </li>
              `).join("")}
             </ol>`
          : `<div class="small muted">まだありません</div>`
      }
    </div>
  `;

  const secTotal = `
    <div class="card" style="max-width:820px;margin:0 auto 14px auto;">
      <h3 style="margin-top:0;">累計人気ネタ TOP3 <span class="muted" style="font-size:12px;">（${state.bucket}%帯）</span></h3>
      ${
        total.length
          ? `<ol style="margin:8px 0 0 1.2em; padding:0;">
              ${total.map(x => `
                <li style="margin:8px 0;">
                  <strong>${escapeHtml(x.text || "")}</strong>${penHtmlIfAny(x.penName)}
                  <div class="small muted">累計いいね ${Number(x.totalLikes || 0)}</div>
                </li>
              `).join("")}
             </ol>`
          : `<div class="small muted">まだありません</div>`
      }
    </div>
  `;

  const secHof = `
    <div class="card" style="max-width:820px;margin:0 auto 0 auto;">
      <h3 style="margin-top:0;">殿堂入り <span class="muted" style="font-size:12px;">（雑学＋お笑い混合 / 1日1回更新）</span></h3>
      ${__hofSnapshotHtml || buildHallHtmlItems(hof, state.mode)}
    </div>
  `;

  el.innerHTML = secToday + secTotal + secHof;

  bindRankingLikeButtons();
}

function bindRankingLikeButtons(){
  const btns = Array.from(document.querySelectorAll("[data-like-id]"));
  btns.forEach(btn => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";

    btn.addEventListener("click", async () => {
      if (btn.disabled) return;

      const itemId = String(btn.dataset.likeId || "").trim();
      const mode = (btn.dataset.likeMode === "fun" ? "fun" : "trivia");
      const bucket = window.bucket10(Number(btn.dataset.likeBucket || 0));
      const text = String(btn.dataset.likeText || "").trim();
      if (!itemId || !text) return;

      btn.disabled = true;
      try{
        const data = await likeAny({
          itemId,
          mode,
          bucket,
          text,
          source: "hof_daily"
        });

        btn.textContent = "❤️ いいね済み";
        btn.style.background = "rgba(239,68,68,.12)";
        likeFxPop(btn);
        likeFxPlusOne(btn);

        const hit = (state.hofTop || []).find(x =>
          String(ensureGlobalItemId({ ...x, source: x?.source || "hof_daily" }, x?.source || "hof_daily")) === itemId
        );
        if (hit){
          hit.totalLikes = Number(data.totalLikes || hit.totalLikes || 0);
          hit.hof = !!data.hof;
          refreshHallHtmlCache();
        }

        if (String(state.currentId || "") === itemId){
          state.currentLikes = Number(data.totalLikes || state.currentLikes || 0);
        }

        loadRankingIfNeeded(true).catch(console.warn);
        scheduleRender();
      }catch(e){
        btn.disabled = false;
        alert(`いいね失敗: ${e.message}`);
      }
    });
  });
}

function renderUsersLine(){
  const el = document.getElementById("usersLine");
  if (!el) return;
  if (state.totalUsers == null){
    el.textContent = "";
    return;
  }
  el.textContent = `現在の利用者数：${Number(state.totalUsers).toLocaleString("ja-JP")}人`;
}

function render(){
  try{
    fixModeToggleAlignment();
  }catch{}

  renderLatestPublic();
  renderRanking();
  renderUsersLine();
}

// ==============================
// ネタ候補の統合
// ==============================
function getBaseItems(mode, bucket){
  const arr = BASE_CANON?.[mode]?.[bucket] || [];
  return arr.map(text => ({
    id: makeGlobalId({ mode, bucket, text, source: "base" }),
    text,
    mode,
    bucket,
    source: "base",
    totalLikes: 0,
    likes: 0,
    hof: false,
    penName: null
  }));
}

async function ensurePublicLoaded(mode, bucket, force = false){
  const b = window.bucket10(bucket);

  if (!force && Array.isArray(state.publicByBucket?.[b]) && state.publicByBucket[b].length){
    return state.publicByBucket[b];
  }

  if (!force){
    const cached = loadPublicCache(mode, b);
    if (Array.isArray(cached) && cached.length){
      state.publicByBucket[b] = cached;
      return cached;
    }
  }

  const items = await fetchPublicMetaphors({ mode, bucket: b, limit: 80 });
  state.publicByBucket[b] = Array.isArray(items) ? items : [];
  state.publicLoadedAt[b] = Date.now();
  savePublicCache(mode, b, state.publicByBucket[b]);
  return state.publicByBucket[b];
}

function buildAllItemsForBucket(mode, bucket){
  const base = getBaseItems(mode, bucket);
  const pub = Array.isArray(state.publicByBucket?.[bucket]) ? state.publicByBucket[bucket] : [];

  const merged = mergeDisplayItems([
    ...base,
    ...pub.map(x => ({
      ...x,
      mode,
      bucket,
      source: "public"
    }))
  ], { mode, bucket });

  return merged.filter(x => !isNgText(x.text));
}

function pickRandomItem(arr){
  const items = Array.isArray(arr) ? arr : [];
  if (!items.length) return null;

  if (window.__forceRepick){
    window.__forceRepick = false;
    return items[Math.floor(Math.random() * items.length)];
  }

  const prevText = normalizeForCompare(state.currentText || "");
  if (!prevText) return items[Math.floor(Math.random() * items.length)];

  const filtered = items.filter(x => normalizeForCompare(x.text) !== prevText);
  const pool = filtered.length ? filtered : items;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ==============================
// ランキング読込（段階表示 & ガード）
// ==============================
async function loadRankingIfNeeded(force = false){
  if (state.bucket == null) return;

  const reqSeq = ++__rankingReqSeq;
  const mode = state.mode;
  const bucket = state.bucket;

  if (!force && state.rankingTodayTop3.length && state.rankingTotalTop3.length && state.hofTop.length){
    return;
  }

  setRankingBusy(true);

  try{
    const today = await fetchRankingTodayAll(mode, 3).catch(e => {
      console.warn("ranking today_all failed", e?.message || e);
      return [];
    });
    if (reqSeq !== __rankingReqSeq) return;

    state.rankingTodayTop3 = (Array.isArray(today) ? today : []).map(x => ({
      ...x,
      mode: (x?.mode === "fun" ? "fun" : "trivia")
    }));
    scheduleRender();

    const total = await fetchRankingTotal(mode, bucket, 3).catch(e => {
      console.warn("ranking total failed", e?.message || e);
      return [];
    });
    if (reqSeq !== __rankingReqSeq) return;

    state.rankingTotalTop3 = Array.isArray(total) ? total : [];
    scheduleRender();

    const latest = await fetchPublicLatest(mode, 10).catch(e => {
      console.warn("public latest failed", e?.message || e);
      return [];
    });
    if (reqSeq !== __rankingReqSeq) return;

    state.latestPublicTop10 = Array.isArray(latest) ? latest : [];
    scheduleRender();

    const snap = await ensureHallSnapshotLoaded().catch(e => {
      console.warn("ensureHallSnapshotLoaded failed", e?.message || e);
      return { items: [], hofThreshold: state.hofThreshold || 20, generatedAt: null };
    });
    if (reqSeq !== __rankingReqSeq) return;

    state.hofThreshold = Number(snap?.hofThreshold || state.hofThreshold || 20);
    state.hofTop = Array.isArray(snap?.items) ? snap.items : [];
    refreshHallHtmlCache();
    scheduleRender();
  } finally {
    if (reqSeq === __rankingReqSeq) setRankingBusy(false);
  }
}

// ==============================
// 天気検索実行
// ==============================
async function runSearch(placeName){
  const seq = ++__searchSeq;
  setSearchBusy(true);
  setStatus("場所を検索しています…");

  try{
    const geo = await geocodePlace(placeName);
    if (seq !== __searchSeq) return;

    const wx = await fetchWeather(geo.latitude, geo.longitude);
    if (seq !== __searchSeq) return;

    const bucket = window.bucket10(wx.precipProb);
    const mode = state.mode;

    weatherCache.set(normalizePlaceName(placeName), { geo, wx, bucket, at: Date.now() });

    state.lastPlaceKey = normalizePlaceName(placeName);
    state.lastPlaceLabel = geo.name;
    state.bucket = bucket;

    saveLastPlace(placeName);
    renderMeta(wx);
    setStatus("公開ネタを読み込んでいます…");

    await ensurePublicLoaded(mode, bucket, false);
    if (seq !== __searchSeq) return;

    const all = buildAllItemsForBucket(mode, bucket);
    state.__allForCurrentBucket = all;

    const picked = pickRandomItem(all);
    if (!picked) throw new Error("ネタがありません");

    state.currentText = picked.text;
    state.currentId = ensureGlobalItemId(picked, picked?.source || "base");
    state.currentSource = picked.source || "base";
    state.currentLikes = Number(picked.totalLikes || picked.likes || 0);

    renderCurrentCard(picked.text, bucket);
    setStatus(`検索完了：${geo.name}`, "ok");

    await pingUsageOncePerDay("wx_ok");
    state.totalUsers = await fetchTotalUsersCached(false);
    scheduleRender();

    loadRankingIfNeeded(false).catch(console.warn);
  }catch(e){
    console.warn("runSearch failed", e);
    setStatus(`検索失敗：${e.message || e}`, "ng");
  } finally {
    if (seq === __searchSeq) setSearchBusy(false);
  }
}

// ==============================
// 別ネタボタン
// ==============================
async function repickCurrent(){
  if (state.bucket == null) return;
  const all = buildAllItemsForBucket(state.mode, state.bucket);
  state.__allForCurrentBucket = all;

  const picked = pickRandomItem(all);
  if (!picked) return;

  state.currentText = picked.text;
  state.currentId = ensureGlobalItemId(picked, picked?.source || "base");
  state.currentSource = picked.source || "base";
  state.currentLikes = Number(picked.totalLikes || picked.likes || 0);

  renderCurrentCard(picked.text, state.bucket);
}

// ==============================
// 投稿フォーム
// ==============================
async function submitCurrentPost(){
  const textEl = document.getElementById("newMetaphor");
  const penEl = document.getElementById("penName");
  const pinEl = document.getElementById("penPin");
  const btn = document.getElementById("submitBtn");

  if (!textEl || !btn) return;

  const text = String(textEl.value || "").trim();
  const penName = String(penEl?.value || "").trim();
  const penPin = String(pinEl?.value || "").trim();

  if (!text){
    alert("ネタを入力してください");
    return;
  }
  if (state.bucket == null){
    alert("先に場所を検索してください");
    return;
  }
  if (isNgText(text)){
    alert("そのネタは投稿できません");
    return;
  }
  if (hasMismatchedPercent(text, state.bucket)){
    alert(`ネタ文中の％表記が、現在の降水確率 ${state.bucket}% と一致していません`);
    return;
  }
  if (hasHard100PercentMismatch(text, state.bucket)){
    alert(`ネタ文中に100%が含まれています。現在の降水確率 ${state.bucket}% のネタとしては投稿できません`);
    return;
  }

  btn.disabled = true;
  const oldLabel = btn.textContent;
  btn.textContent = "投稿中…";

  try{
    await submitToPending(
      state.mode,
      state.bucket,
      text,
      penName,
      penPin,
      getClientId()
    );

    textEl.value = "";
    if (pinEl) pinEl.value = "";
    btn.textContent = "投稿ありがとうございました";
    setTimeout(() => {
      btn.textContent = oldLabel;
      btn.disabled = false;
    }, 1400);
  }catch(e){
    alert(`投稿失敗: ${e.message}`);
    btn.textContent = oldLabel;
    btn.disabled = false;
  }
}

// ==============================
// 初期化
// ==============================
async function boot(){
  try{
    loadNoteBanners().catch(console.warn);

    const saved = loadLastPlace();
    const placeInput = document.getElementById("place");
    if (placeInput && saved) placeInput.value = saved;

    const modeInputs = Array.from(document.querySelectorAll('input[name="mode"]'));
    modeInputs.forEach(inp => {
      inp.checked = (inp.value === state.mode);
      inp.addEventListener("change", async () => {
        state.mode = (inp.value === "fun" ? "fun" : "trivia");

        state.rankingTodayTop3 = [];
        state.rankingTotalTop3 = [];
        state.latestPublicTop10 = [];

        if (state.bucket != null){
          await ensurePublicLoaded(state.mode, state.bucket, false).catch(console.warn);

          const all = buildAllItemsForBucket(state.mode, state.bucket);
          state.__allForCurrentBucket = all;

          const picked = pickRandomItem(all);
          if (picked){
            state.currentText = picked.text;
            state.currentId = ensureGlobalItemId(picked, picked?.source || "base");
            state.currentSource = picked.source || "base";
            state.currentLikes = Number(picked.totalLikes || picked.likes || 0);
            renderCurrentCard(picked.text, state.bucket);
          }
        }

        scheduleRender();
        loadRankingIfNeeded(true).catch(console.warn);
      });
    });

    const searchBtn = document.getElementById("search");
    if (searchBtn){
      searchBtn.addEventListener("click", async () => {
        const place = String(document.getElementById("place")?.value || "").trim();
        if (!place){
          setStatus("場所を入力してください", "ng");
          return;
        }
        await runSearch(place);
      });
    }

    const placeInputEl = document.getElementById("place");
    if (placeInputEl){
      placeInputEl.addEventListener("keydown", async (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const place = String(placeInputEl.value || "").trim();
        if (!place){
          setStatus("場所を入力してください", "ng");
          return;
        }
        await runSearch(place);
      });
    }

    const repickBtn = document.getElementById("repickBtn");
    if (repickBtn){
      repickBtn.addEventListener("click", async () => {
        window.__forceRepick = true;
        await repickCurrent();
      });
    }

    const submitBtn = document.getElementById("submitBtn");
    if (submitBtn){
      submitBtn.addEventListener("click", submitCurrentPost);
    }

    state.totalUsers = await fetchTotalUsersCached(false);
    scheduleRender();

    const savedPlace = String(loadLastPlace() || "").trim();
    if (savedPlace){
      runSearch(savedPlace).catch(console.warn);
    } else {
      ensureHallSnapshotLoaded()
        .then(snap => {
          state.hofThreshold = Number(snap?.hofThreshold || state.hofThreshold || 20);
          state.hofTop = Array.isArray(snap?.items) ? snap.items : [];
          refreshHallHtmlCache();
          scheduleRender();
        })
        .catch(console.warn);

      fetchPublicLatest(state.mode, 10)
        .then(items => {
          state.latestPublicTop10 = Array.isArray(items) ? items : [];
          scheduleRender();
        })
        .catch(console.warn);
    }
  }catch(e){
    console.warn("boot failed", e);
  }
}

// ==============================
// 画面ロード
// ==============================
document.addEventListener("DOMContentLoaded", () => {
  boot();
});

// ==============================
// デバッグ補助
// ==============================
window.__appState = state;
window.__appDebug = {
  BUILD,
  API_BASE,
  HOF_DAILY_JSON_URL,
  forceReloadHall: async () => {
    try{ localStorage.removeItem(HOF_DAILY_CACHE_KEY); }catch{}
    __hofSnapshotMemory = null;
    __hofSnapshotHtml = null;
    const snap = await ensureHallSnapshotLoaded();
    state.hofTop = Array.isArray(snap?.items) ? snap.items : [];
    refreshHallHtmlCache();
    scheduleRender();
    return snap;
  },
  clearPublicCache: () => {
    try{
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith(PUBLIC_CACHE_PREFIX)) localStorage.removeItem(k);
      });
    }catch{}
  },
  clearUsageCache: () => {
    try{
      localStorage.removeItem("usage_ping_day_v1");
    }catch{}
  }
};

// ==============================
// 互換用：既存HTMLが参照しても落ちないように
// ==============================
window.runSearch = runSearch;
window.repickCurrent = repickCurrent;
window.submitCurrentPost = submitCurrentPost;

// END

    
