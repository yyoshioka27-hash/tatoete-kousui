// script.js
// ✅ API_BASE（あなたのPCで /api/health がOKだった“正”）
const API_BASE = "https://ancient-union-4aa4tatoete-kousui-api.y-yoshioka27.workers.dev";

// =========================
// ✅FIX: render 多重呼び出し防止（固まり対策）
// requestAnimationFrame で 1フレームに 1回だけ render
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
// ✅ NGワード（表示から除外したい文字列）
// 「データから削除」相当として、全ソース(base/json/public)で表示しない
// =========================
const NG_PHRASES = [
  "共通テスト",
];

function isNgText(text){
  const t = String(text || "");
  if (!t) return true;
  return NG_PHRASES.some(ng => ng && t.includes(ng));
}

// =========================
// ✅ いいね演出用CSSを注入（HTML改修不要）
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

    /* ✅匿名を薄く */
    .pen-muted { opacity: .55; font-weight: 700; }

    /* ✅殿堂入りバッジ */
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
// ✅ 合言葉（PIN）入力欄をJS側で自動生成（HTML改修不要）
// ==============================
(function ensurePenPinDom(){
  const pen = document.getElementById("penName");
  if (!pen) return;
  if (document.getElementById("penPin")) return;

  const pin = document.createElement("input");
  pin.id = "penPin";
  pin.type = "password";
  pin.autocomplete = "off";
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
// 承認待ち投稿（Workers）
// ==============================
async function submitToPending(mode, bucket, text, penName, penPin){
  const res = await fetch(`${API_BASE}/api/submit`, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ mode, bucket, text, penName, penPin, from: "mobile" })
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
// 返り値：[{id, text, penName, totalLikes, hof}, ...]
// ==============================
async function fetchPublicMetaphors({ mode, bucket, limit = 50 }) {
  const params = new URLSearchParams();
  if (mode) params.set("mode", mode);
  if (Number.isFinite(bucket)) params.set("bucket", String(bucket));
  params.set("limit", String(limit));

  const url = `${API_BASE}/api/public?${params.toString()}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`public fetch failed: ${res.status}`);
  const data = await res.json().catch(()=>null);
  if (!data?.ok) throw new Error("public not ok");

  // ✅ 殿堂入り閾値も受け取る（無ければ20）
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
    .filter(x => !isNgText(x.text)); // ✅ NG排除
}

// ==============================
// ✅ いいね（Workers）
// - public/base/json すべて対象
// - 返り値：{ likesToday, totalLikes, hof, hofThreshold }
// ==============================
async function likeAny(payload){
  const res = await fetch(`${API_BASE}/api/like`, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `like failed ${res.status}`);

  // ✅ 閾値を同期
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
  const res = await fetch(`${API_BASE}/api/ranking/today?${params.toString()}`, { method:"GET" });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `ranking failed ${res.status}`);
  return Array.isArray(data.items) ? data.items : [];
}

// ==============================
// ✅ 累計ランキング（Workers）
// ==============================
async function fetchRankingTotal(mode, bucket, limit = 3){
  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("bucket", String(bucket));
  params.set("limit", String(limit));
  const res = await fetch(`${API_BASE}/api/ranking/total?${params.toString()}`, { method:"GET" });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `ranking total failed ${res.status}`);
  if (data.hofThreshold != null) state.hofThreshold = Number(data.hofThreshold || state.hofThreshold || 20);
  return Array.isArray(data.items) ? data.items : [];
}

// ==============================
// ✅ 殿堂入り（Workers）
// ==============================
async function fetchHallOfFame(mode, bucket, limit = 50){
  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("bucket", String(bucket));
  params.set("limit", String(limit));
  const res = await fetch(`${API_BASE}/api/hof?${params.toString()}`, { method:"GET" });
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
      .filter(it => !isNgText(it.text)); // ✅ NG排除

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
    .filter(x => !isNgText(x.text)); // ✅ NG排除
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

let state = {
  pops: null,
  placeLabel: null,
  tz: null,
  source: "API: 未接続",

  // ✅ 殿堂入り閾値（サーバから受け取る）
  hofThreshold: 20,

  currentPhrases: {
    m: { text: null, source: null, id: null, penName: null, likesToday: 0, totalLikes: 0, hof: false, mode: null, bucket: null },
    d: { text: null, source: null, id: null, penName: null, likesToday: 0, totalLikes: 0, hof: false, mode: null, bucket: null },
    e: { text: null, source: null, id: null, penName: null, likesToday: 0, totalLikes: 0, hof: false, mode: null, bucket: null }
  }
};

const $ = (id) => document.getElementById(id);

// =========================
// ✅ 全ネタを一意ID化（base/json も集計対象）
// =========================
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
  const b = window.bucket10(bucket);
  const s = String(source || "base");
  const t = String(text || "").trim();
  return `m_${m}_b_${b}_${s}_${fnv1a32(`${m}|${b}|${s}|${t}`)}`;
}

// =========================
// お天気アイコン（%の前）
// =========================
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

// =========================
// ✅ いいねUI：既存HTMLを活かしつつ、足りない要素は自動生成
// =========================
function ensureLikeDom(slot){
  // 既存のHTMLがある前提（like_m / likeCount_m / badge_m）
  const btn = document.getElementById(`like_${slot}`);
  let count = document.getElementById(`likeCount_${slot}`);
  let badge = document.getElementById(`badge_${slot}`);

  if (!btn) return;

  // ✅ 既存ボタンに演出クラスを付与
  btn.classList.add("like-btn-pop");

  // ✅ likeCount が無ければ作る（"??"対策の本丸）
  // 期待する見た目：ボタン内に「👍 <span id=likeCount_x>0</span>」の形に寄せる
  if (!count) {
    // ボタン内のテキストが "??" などでも確実に置き換えられるように、span を作る
    const span = document.createElement("span");
    span.id = `likeCount_${slot}`;
    span.textContent = "0";
    span.style.fontWeight = "900";
    span.style.marginLeft = "6px";

    // ボタン内を整理（既存HTMLがどうであれ壊れにくいように）
    // 例：btn.textContent が "👍??" でも、一旦 "👍" にして count を差す
    const baseLabel = "👍";
    btn.textContent = baseLabel;
    btn.appendChild(span);

    count = span;
  }

  // ✅ 累計が無ければ作る（古いHTML対策）
  const totalId = `likeTotal_${slot}`;
  let total = document.getElementById(totalId);
  if (!total) {
    // like ボタンの直後に累計を置く
    total = document.createElement("span");
    total.id = totalId;
    total.className = "muted";
    total.textContent = "累計👍0";
    total.style.marginLeft = "10px";
    btn.insertAdjacentElement("afterend", total);
  }

  // ✅ badge が無ければ作る（古いHTML対策）
  if (!badge) {
    const wrap = btn.parentElement;
    if (wrap) {
      const b = document.createElement("span");
      b.id = `badge_${slot}`;
      b.style.marginLeft = "6px";
      wrap.appendChild(b);
      badge = b;
    }
  }
}


  // ✅ badge が無ければ作る（古いHTML対策）
  if (!badge) {
    const wrap = btn?.parentElement;
    if (wrap) {
      const b = document.createElement("span");
      b.id = `badge_${slot}`;
      b.style.marginLeft = "6px";
      wrap.appendChild(b);
    }
  }

  // count が無い場合はボタン内カウント更新を諦めるが、通常はあるのでOK
  if (!count && btn) {
    // 何もしない（最低限動作はする）
  }
}

// =========================
// ネタ抽選（base + JSON + public）
// =========================
const lastPickKey = {};

function getSelectedMode() {
  const el = document.querySelector('input[name="mode"]:checked');
  return el ? el.value : "trivia";
}

function getBaseTexts(mode, bucket) {
  bucket = Number(bucket);
  const base = (mode === "trivia"
    ? (window.NETA_TRIVIA?.[bucket] ?? [])
    : (window.NETA?.[bucket] ?? []));
  return base
    .map(x => String(x || "").trim())
    .filter(Boolean)
    .filter(t => !isNgText(t)); // ✅ NG排除
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
    if (isNgText(t)) continue; // ✅ NG排除（念押し）
    if (seen.has(t)) continue;
    seen.add(t);

    out.push({
      text: t,
      source: item.source || "base",
      id: item.id || makeGlobalId({ mode: m, bucket: b, text: t, source: item.source || "base" }),
      penName: item.penName || null,
      totalLikes: Number(item.totalLikes || 0),
      hof: !!item.hof
    });
  }
  return out;
}

function pickMetaphor(mode, bucket) {
  const b = window.bucket10(bucket);
  const pool = buildCandidatePool(mode, b);
  if (!pool.length) return { text: "データなし", source: null, id: null, penName: null, totalLikes: 0, hof: false };

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

// =========================
// ✅ ランキングが参照する “代表バケット”
// =========================
function getCurrentMainBucket(){
  if (!state?.pops) return null;
  const arr = [state.pops.m, state.pops.d, state.pops.e].filter(v => v != null);
  if (!arr.length) return null;
  return window.bucket10(Math.max(...arr));
}

// =========================
// ✅ UI（公開ネタ＝全部対象）
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
      const mainBucket = getCurrentMainBucket();
      const out = await likeAny({
        id: phraseObj.id,
        mode: phraseObj.mode || getSelectedMode(),
        bucket: Number(mainBucket ?? phraseObj.bucket ?? 0),
        text: phraseObj.text,
        penName: (phraseObj.penName && phraseObj.penName !== "匿名") ? phraseObj.penName : null,
        source: phraseObj.source || null
      });

      likeFxPop(btnEl);
      likeFxPlusOne(btnEl);

      state.currentPhrases[slot].likesToday = Number(out.likesToday || 0);
      state.currentPhrases[slot].totalLikes = Number(out.totalLikes || state.currentPhrases[slot].totalLikes || 0);
      state.currentPhrases[slot].hof = !!out.hof || (state.currentPhrases[slot].totalLikes >= Number(state.hofThreshold || 20));

      updateLikeUI(slot);
      try { renderRanking(); } catch {}
    }catch(e){
      alert(`いいね失敗：${e?.message || e}`);
    }finally{
      btnEl.disabled = false;
    }
  };
}

// =========================
// 「このネタを削除」：ローカルネタ廃止につき常に非表示
// =========================
function updateDeleteUI(slotKey) {
  const btn = document.getElementById(`del_${slotKey}`);
  if (!btn) return;
  btn.style.display = "none";
  btn.onclick = null;
}

// =========================
// UI helper
// =========================
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
// theme（無ければ何もしない）
// =========================
function applyTheme(_rounded){
  // 既存のHTML/CSS側にapplyThemeがあったり、色テーマ拡張してる場合に備えてダミー
}

// =========================
// render
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

      state.currentPhrases[slotKey] = { text: null, source: null, id: null, penName: null, likesToday: 0, totalLikes: 0, hof: false, mode: null, bucket: null };
      updateLikeUI(slotKey);
      updateDeleteUI(slotKey);
      return null;
    }

    const rounded = window.bucket10(value);
    if (popEl) popEl.textContent = `${rounded}%`;
    setIcon(slotKey, rounded);

    const mode = getSelectedMode();
    let picked = pickMetaphor(mode, rounded);

    // ✅ 万一 NG を引いたら再抽選（最大5回）
    for (let i=0; i<5 && picked?.text && isNgText(picked.text); i++){
      picked = pickMetaphor(mode, rounded);
    }
    if (picked?.text && isNgText(picked.text)) {
      picked = { text: "（非表示ワードが含まれるため表示できません）", source: null, id: null, penName: null, totalLikes: 0, hof: false };
    }

    // ✅ ペンネーム未入力は常に「匿名」で統一（薄く表示）
    const displayPen = (picked.penName && String(picked.penName).trim())
      ? String(picked.penName).trim()
      : "匿名";

    const totalLikesPicked = Number(picked.totalLikes || 0);
    const hofPicked = !!picked.hof || (totalLikesPicked >= Number(state.hofThreshold || 20));

    if (metaEl) {
      const penHtml = (displayPen === "匿名")
        ? `<span class="pen-muted">（匿名）</span>`
        : `<span class="muted">（${escapeHtml(displayPen)}）</span>`;

      const hofHtml = hofPicked ? ` <span class="hof-badge">👑殿堂入り</span>` : "";

      metaEl.innerHTML = `${escapeHtml(label)}：${escapeHtml(picked.text)} ${penHtml}${hofHtml}`;
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

    return { value: rounded, text: picked.text, label };
  };

  if (!state.pops) {
    if (hintEl) hintEl.textContent = "地点を選ぶと自動取得します";
    renderEmpty();
    if (footEl) footEl.textContent = "";
    try { renderRanking(); } catch {}
    return;
  }

  if (hintEl) hintEl.textContent = state.placeLabel ? `地点：${state.placeLabel}` : "地点：--";

  const a = setSlot("m", state.pops.m, "朝");
  const b = setSlot("d", state.pops.d, "昼");
  const c = setSlot("e", state.pops.e, "夜");

  const candidates = [a, b, c].filter(Boolean);
  if (!candidates.length) {
    if (metaAll) metaAll.textContent = "データが取得できませんでした（別地点で試してください）";
  } else {
    const maxOne = candidates.reduce((x, y) => (y.value > x.value ? y : x));
    if (metaAll) metaAll.textContent = `今日いちばん怪しいのは【${maxOne.label}】：${maxOne.value}% → ${maxOne.text}`;
  }

  if (footEl) footEl.textContent =
    "※降水確率を0/10/…/100%に丸め、公開ネタ（public/base/json）からランダム表示";

  try { renderRanking(); } catch {}
}

function renderEmpty() {
  const metaAll = document.getElementById("metaphor");

  ["m","d","e"].forEach(k => {
    const popEl = document.getElementById(`pop_${k}`);
    const metaEl = document.getElementById(`meta_${k}`);

    if (popEl) popEl.textContent = "--%";
    if (metaEl) metaEl.textContent = "データなし";

    setIcon(k, null);

    state.currentPhrases[k] = { text: null, source: null, id: null, penName: null, likesToday: 0, totalLikes: 0, hof: false, mode: null, bucket: null };
    updateLikeUI(k);
    updateDeleteUI(k);
  });

  if (metaAll) metaAll.textContent = "地点を選んでください";
}

// =========================
// API
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

async function fetchPopsBySlots(lat, lon) {
  const url = new URL(FC);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("hourly", "precipitation_probability");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "2");

  const res = await fetch(url.toString(), { cache: "no-store" });
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

// =========================
// ✅ ランキングDOM（既にindexにあるなら何もしない）
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
// ランキング表示（例えを変えるボタンの下）
// - 今日TOP3
// - 累計TOP3
// - 殿堂入り（累計閾値以上）
// =========================
async function renderRanking(){
  ensureRankingDom();
  const wrap = document.getElementById("todayRankingWrap");
  if (!wrap) return;

  const bucket = getCurrentMainBucket();
  const mode = getSelectedMode();

  if (bucket == null) {
    wrap.innerHTML = "";
    return;
  }

  const hofTh = Number(state.hofThreshold || 20);

  wrap.innerHTML = `
    <div class="card" style="margin:0 0 10px 0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
      <div style="font-weight:900; font-size:16px; margin-bottom:6px;">今日のランキング TOP3（${bucket}% / ${mode==="fun"?"お笑い":"雑学"}）</div>
      <div class="muted" style="margin-bottom:8px;">※今日(JST)のいいね数で集計（毎日0:00にリセット）</div>
      <div class="muted" id="rankingBodyToday">読み込み中…</div>
    </div>

    <div class="card" style="margin:0 0 10px 0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
      <div style="font-weight:900; font-size:16px; margin-bottom:6px;">累計ランキング TOP3（${bucket}% / ${mode==="fun"?"お笑い":"雑学"}）</div>
      <div class="muted" style="margin-bottom:8px;">※累計👍（全期間）で集計</div>
      <div class="muted" id="rankingBodyTotal">読み込み中…</div>
    </div>

    <div class="card" style="margin:0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
      <div style="font-weight:900; font-size:16px; margin-bottom:6px;">殿堂入り（累計👍${hofTh}以上）</div>
      <div class="muted" style="margin-bottom:8px;">※殿堂入りは累計が閾値を超えると自動で表示</div>
      <div class="muted" id="rankingBodyHof">読み込み中…</div>
    </div>
  `;

  const bodyToday = document.getElementById("rankingBodyToday");
  const bodyTotal = document.getElementById("rankingBodyTotal");
  const bodyHof   = document.getElementById("rankingBodyHof");

  // ---- 今日TOP3 ----
  try{
    const items = (await fetchRankingToday(mode, bucket, 3))
      .filter(it => !isNgText(it?.text)); // ✅ NG排除

    if (!items.length) {
      if (bodyToday) bodyToday.textContent = "まだランキングがありません（今日の👍が0件）";
    } else {
      const rows = items.map((it, idx) => {
        const p = (it.penName && String(it.penName).trim()) ? String(it.penName).trim() : "匿名";
        const pen = (p === "匿名")
          ? ` <span class="pen-muted">（匿名）</span>`
          : ` <span class="muted">（${escapeHtml(p)}）</span>`;
        const src = it.source ? ` <span class="muted">[${escapeHtml(it.source)}]</span>` : "";
        return `
          <div style="padding:10px 0; border-top:1px solid rgba(15,23,42,0.10);">
            <div style="font-weight:800;">${idx+1}位：${escapeHtml(it.text)}${pen}${src}</div>
            <div class="muted">今日の👍：${Number(it.likes||0)}</div>
          </div>
        `;
      }).join("");
      if (bodyToday) bodyToday.innerHTML = rows;
    }
  } catch (e) {
    if (bodyToday) bodyToday.textContent = `ランキング取得に失敗：${e?.message || e}`;
  }

  // ---- 累計TOP3 ----
  try{
    const items = (await fetchRankingTotal(mode, bucket, 3))
      .filter(it => !isNgText(it?.text)); // ✅ NG排除

    if (!items.length) {
      if (bodyTotal) bodyTotal.textContent = "まだ累計ランキングがありません（累計👍が0件）";
    } else {
      const rows = items.map((it, idx) => {
        const p = (it.penName && String(it.penName).trim()) ? String(it.penName).trim() : "匿名";
        const pen = (p === "匿名")
          ? ` <span class="pen-muted">（匿名）</span>`
          : ` <span class="muted">（${escapeHtml(p)}）</span>`;
        const src = it.source ? ` <span class="muted">[${escapeHtml(it.source)}]</span>` : "";
        const totalLikes = Number(it.totalLikes || 0);
        const hof = !!it.hof || (totalLikes >= Number(state.hofThreshold || 20));
        const hofTag = hof ? ` <span class="hof-badge">👑殿堂入り</span>` : "";
        return `
          <div style="padding:10px 0; border-top:1px solid rgba(15,23,42,0.10);">
            <div style="font-weight:800;">${idx+1}位：${escapeHtml(it.text)}${pen}${src}${hofTag}</div>
            <div class="muted">累計👍：${totalLikes}</div>
          </div>
        `;
      }).join("");
      if (bodyTotal) bodyTotal.innerHTML = rows;
    }
  } catch (e) {
    if (bodyTotal) bodyTotal.textContent = `累計ランキング取得に失敗：${e?.message || e}`;
  }

  // ---- 殿堂入り ----
  try{
    const items = (await fetchHallOfFame(mode, bucket, 50))
      .filter(it => !isNgText(it?.text)); // ✅ NG排除

    const hofTh2 = Number(state.hofThreshold || 20);

    if (!items.length) {
      if (bodyHof) bodyHof.textContent = `まだ殿堂入りがありません（累計👍${hofTh2}以上が0件）`;
    } else {
      const rows = items.slice(0, 20).map((it, idx) => {
        const p = (it.penName && String(it.penName).trim()) ? String(it.penName).trim() : "匿名";
        const pen = (p === "匿名")
          ? ` <span class="pen-muted">（匿名）</span>`
          : ` <span class="muted">（${escapeHtml(p)}）</span>`;
        const src = it.source ? ` <span class="muted">[${escapeHtml(it.source)}]</span>` : "";
        const totalLikes = Number(it.totalLikes || 0);
        return `
          <div style="padding:10px 0; border-top:1px solid rgba(15,23,42,0.10);">
            <div style="font-weight:800;">${idx+1}. ${escapeHtml(it.text)}${pen}${src} <span class="hof-badge">👑殿堂入り</span></div>
            <div class="muted">累計👍：${totalLikes}</div>
          </div>
        `;
      }).join("");

      const more = (items.length > 20)
        ? `<div class="muted" style="margin-top:8px;">※表示は上位20件まで（全${items.length}件）</div>`
        : "";

      if (bodyHof) bodyHof.innerHTML = rows + more;
    }
  } catch (e) {
    if (bodyHof) bodyHof.textContent = `殿堂入り取得に失敗：${e?.message || e}`;
  }
}

// =========================
// UI: 検索→候補表示
// =========================
document.getElementById("search").onclick = async () => {
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

      state.placeLabel = opt.textContent;
      state.source = "API: Open-Meteo";

      scheduleRender();
      setStatus("天気取得中…", "muted");

      try {
        const out = await fetchPopsBySlots(lat, lon);
        state.pops = out.pops;
        state.tz = out.tz;

        await Promise.all([
          warmPublicCache(getSelectedMode(), state.pops?.m ?? 0),
          warmPublicCache(getSelectedMode(), state.pops?.d ?? 0),
          warmPublicCache(getSelectedMode(), state.pops?.e ?? 0),
        ]);

        const any = (state.pops.m != null) || (state.pops.d != null) || (state.pops.e != null);
        if (!any) {
          setStatus("降水確率が取得できませんでした（別地点で試してください）", "ng");
          state.source = "API: 取得失敗";
          state.pops = null;
        } else {
          setStatus("取得しました", "ok");
        }

        scheduleRender();
      } catch (e) {
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

document.querySelectorAll('input[name="mode"]').forEach(r =>
  r.addEventListener("change", async () => {
    if (state?.pops) {
      await Promise.all([
        warmPublicCache(getSelectedMode(), state.pops?.m ?? 0),
        warmPublicCache(getSelectedMode(), state.pops?.d ?? 0),
        warmPublicCache(getSelectedMode(), state.pops?.e ?? 0),
      ]);
    }
    scheduleRender();
  })
);

document.getElementById("refresh").onclick = () => scheduleRender();

// ==============================
// ✅ ネタ追加（承認待ちへ送信）
// - ✅ index.html のIDに完全一致（mode/bucketが効く）
// - ✅ ペンネーム指定時はPIN必須（救済なし）
// - ✅ ペンネーム空欄ならPIN不要（= 匿名投稿）
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
      await submitToPending(mode, window.bucket10(bucket), text, (penName || null), (penName ? penPin : null));
      ta.value = "";
      alert("承認待ちに送信しました（管理画面で承認すると公開されます）");

      const b = window.bucket10(bucket);
      const k = keyMB(mode, b);
      publicCache.delete(k);
      await warmPublicCache(mode, b);

      scheduleRender();
    }catch(e){
      alert(`送信失敗：${e?.message || e}`);
    }finally{
      btn.disabled = false;
      btn.textContent = oldText || "承認待ちへ送信";
    }
  }, { passive:false });

  console.log("wireSubmit: bound OK", btn);
}

// ==============================
// ✅ 初期化
// ==============================
async function init(){
  try { ensureRankingDom(); } catch {}
  try { await loadSharedJSON(); } catch {}
  try { wireSubmit(); } catch (e) { console.warn(e); }
  try { scheduleRender(); } catch {}
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

// # END
