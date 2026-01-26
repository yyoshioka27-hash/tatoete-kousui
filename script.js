// script.js
// ✅ API_BASE（あなたのPCで /api/health がOKだった“正”）
const API_BASE = "https://ancient-union-4aa4tatoete-kousui-api.y-yoshioka27.workers.dev";




// ==============================
// 承認待ち投稿（Workers）
// ==============================
async function submitToPending(mode, bucket, text){
  const res = await fetch(`${API_BASE}/api/submit`, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ mode, bucket, text, from: "mobile" })
  });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `submit failed ${res.status}`);
  return data;
}

async function fetchPublicMetaphors({ mode, bucket, limit = 50 }) {
  const params = new URLSearchParams();
  if (mode) params.set("mode", mode);
  if (Number.isFinite(bucket)) params.set("bucket", String(bucket));
  params.set("limit", String(limit));

  const url = `${API_BASE}/api/public?${params.toString()}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`public fetch failed: ${res.status}`);
  const data = await res.json();
  if (!data?.ok) throw new Error("public not ok");
  return (data.items || []).map(x => x.text).filter(Boolean);
}

// ==============================
// 共有ネタ（GitHub PagesのJSON）
// ※ 起動時に読み込んで抽選候補へ混ぜる
// ==============================
const SHARED_JSON_URL = "./metaphors.json";

let sharedItems = []; // [{mode,bucket,text}, ...]

// 互換用（過去に入れた人向け）: JSON items をここにも入れる
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
      .filter(it => it.text);

    // 互換：window.JSON_METAPHORS にも反映
    window.JSON_METAPHORS = items || [];
  } catch (e) {
    sharedItems = [];
    window.JSON_METAPHORS = [];
  }
}

function getSharedItems(mode, bucket) {
  const m = (mode === "fun" ? "fun" : "trivia");
  const b = window.bucket10(bucket);

  // sharedItems を優先。空なら window.JSON_METAPHORS もフォールバックで使う
  const base = (sharedItems && sharedItems.length)
    ? sharedItems
    : (Array.isArray(window.JSON_METAPHORS) ? window.JSON_METAPHORS.map(it => ({
        mode: (it?.mode === "fun" ? "fun" : "trivia"),
        bucket: window.bucket10(Number(it?.bucket)),
        text: String(it?.text || "").trim()
      })).filter(x => x.text) : []);

  return base.filter(x => x.mode === m && x.bucket === b);
}

// ==============================
// ✅ 共有ネタ（Cloudflare Workers /api/public）
// - public を抽選候補へ混ぜる
// - mode×bucket のキャッシュ
// ==============================
const publicCache = new Map(); // key: "mode_bucket" => [text,...]

function keyMB(mode, bucket){
  const m = (mode === "fun" ? "fun" : "trivia");
  const b = window.bucket10(bucket);
  return `${m}_${b}`;
}

async function warmPublicCache(mode, bucket){
  const k = keyMB(mode, bucket);
  if (publicCache.has(k)) return;

  try{
    const texts = await fetchPublicMetaphors({
      mode: (mode === "fun" ? "fun" : "trivia"),
      bucket: window.bucket10(bucket),
      limit: 200
    });
    publicCache.set(k, texts);
  }catch{
    publicCache.set(k, []); // 失敗時も空で確定（無限リトライ防止）
  }
}

function getPublicItems(mode, bucket){
  const k = keyMB(mode, bucket);

  // ✅ 未warmなら裏でwarmして次回renderで混ざるようにする
  if (!publicCache.has(k)) {
    warmPublicCache(mode, bucket).then(() => {
      try { render(); } catch {}
    }).catch(() => {});
    return [];
  }

  const arr = publicCache.get(k) || [];
  return arr.map(t => ({ text: String(t || "").trim(), extraId: null })).filter(x => x.text);
}

// 旧キーの掃除（そのまま維持）
["addedPhrases"].forEach(k => localStorage.removeItem(k));

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
  currentPhrases: {
    m: { text: null, extraId: null },
    d: { text: null, extraId: null },
    e: { text: null, extraId: null }
  }
};

const $ = (id) => document.getElementById(id);

// =========================
// 📌 公開準備（ローカル）
// =========================
const LIKES_KEY = "metaphorLikes";

function loadLikes() {
  try { return JSON.parse(localStorage.getItem(LIKES_KEY) || '{}'); }
  catch { return {}; }
}
function saveLikes(obj) { localStorage.setItem(LIKES_KEY, JSON.stringify(obj)); }

let likesData = loadLikes();

function getSelectedMode() {
  const el = document.querySelector('input[name="mode"]:checked');
  return el ? el.value : "trivia";
}
function getLikesFor(phrase) { return likesData[phrase] || 0; }
function incrementLike(phrase) {
  likesData[phrase] = (likesData[phrase] || 0) + 1;
  saveLikes(likesData);
}

// =========================
// ✅ 本当の「公開準備ピン」管理（解除できる）
// =========================
const PIN_KEY = "metaphorPins_v1";

function loadPins(){
  try { return JSON.parse(localStorage.getItem(PIN_KEY) || "{}"); }
  catch { return {}; }
}
function savePins(obj){ localStorage.setItem(PIN_KEY, JSON.stringify(obj)); }

let pinData = loadPins();

function isPinned(phrase){
  return !!pinData[phrase];
}
function setPinned(phrase, pinned){
  if (!phrase) return;
  if (pinned) pinData[phrase] = 1;
  else delete pinData[phrase];
  savePins(pinData);
}
function togglePinned(phrase){
  setPinned(phrase, !isPinned(phrase));
}

// ==============================
// ✅ 承認待ち送信キュー（iPhone連続POST対策）
// - 追加時：キューに貯める（送信はしない）
// - 送信ボタン：1件ずつ送る（待ち時間を入れる）
// ==============================
const PENDING_QUEUE_KEY = "pending_queue_v1";

function loadQueue(){
  try {
    const q = JSON.parse(localStorage.getItem(PENDING_QUEUE_KEY) || "[]");
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}
function saveQueue(q){
  localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(Array.isArray(q) ? q : []));
}
function queueForPending(mode, bucket, text){
  const m = (mode === "fun" ? "fun" : "trivia");
  const b = window.bucket10(bucket);
  const t = String(text || "").trim();
  if (!t) return { ok:false, msg:"ネタが空です" };

  const q = loadQueue();

  // 同一(mode,bucket,text)は重複登録しない（送信事故防止）
  const key = `${m}__${b}__${t}`;
  const exists = q.some(x => `${x.mode}__${x.bucket}__${x.text}` === key);
  if (!exists) q.push({ mode:m, bucket:b, text:t, at: Date.now() });

  saveQueue(q);
  return { ok:true, msg: exists ? "送信待ちに既にあります" : "送信待ちに追加しました" };
}
function queueCount(){
  return loadQueue().length;
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function sendQueueAll({ delayMs = 1200 } = {}){
  const statusEl = document.getElementById("addStatus");
  let q = loadQueue();

  if (!q.length) {
    if (statusEl) statusEl.textContent = "送信待ちはありません。";
    updateSendBtnLabel();
    return;
  }

  if (statusEl) statusEl.textContent = `📨 承認待ちへ送信中…（${q.length}件 / 1件ずつ送ります）`;

  const rest = [];
  let okCount = 0;

  for (const item of q){
    try{
      await submitToPending(item.mode, item.bucket, item.text);
      okCount++;
      // ✅ iPhone Safari対策：連続POSTを避ける
      await sleep(delayMs);
    }catch(e){
      rest.push(item);
      // 失敗しても次へ。通信が落ち着いたら次回再送できる
      await sleep(delayMs);
    }
  }

  saveQueue(rest);
  updateSendBtnLabel();

  if (statusEl) {
    if (rest.length === 0) {
      statusEl.textContent = `✅ 承認待ちへ送信しました（成功 ${okCount}件）\n👉 管理画面で承認すると一般公開されます。`;
    } else {
      statusEl.textContent = `⚠️ 一部送信に失敗しました（成功 ${okCount}件 / 残り ${rest.length}件）\n📨 もう一度「承認待ちへ送信」を押すと再送できます。`;
    }
  }
}

let sendBtnEl = null;

function ensureSendBtn(){
  // addSection の中で addPhraseBtn の近くにボタンを自動挿入
  const addBtn = document.getElementById("addPhraseBtn");
  if (!addBtn) return;

  if (sendBtnEl && document.getElementById(sendBtnEl.id)) {
    updateSendBtnLabel();
    return;
  }

  const wrap = addBtn.parentElement; // actions
  if (!wrap) return;

  const btn = document.createElement("button");
  btn.id = "sendPendingAll";
  btn.className = "btnPrimary";
  btn.style.whiteSpace = "nowrap";
  btn.textContent = "📨 承認待ちへ送信（0件）";
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      await sendQueueAll({ delayMs: 1200 });
    } finally {
      btn.disabled = false;
      updateSendBtnLabel();
    }
  };

  // 追加ボタンの右側に入れる（末尾）
  wrap.appendChild(btn);
  sendBtnEl = btn;

  updateSendBtnLabel();
}

function updateSendBtnLabel(){
  const btn = document.getElementById("sendPendingAll");
  if (!btn) return;
  const n = queueCount();
  btn.textContent = `📨 承認待ちへ送信（${n}件）`;
  btn.disabled = (n === 0);
}

// ==============================
// 追加ネタ（localStorage）
// ==============================
const EXTRA_LS_KEY = "extra_phrases_v1";

function genId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function safeParseJSON(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function normalizeExtraList(list) {
  const out = [];
  const seen = new Set();

  for (const item of (list || [])) {
    if (!item) continue;

    const mode = (item.mode === "fun" ? "fun" : "trivia");
    const bucket = window.bucket10(Number(item.bucket));
    const text = String(item.text || "").trim();
    if (!text) continue;

    const key = `${mode}__${bucket}__${text}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      id: String(item.id || genId()),
      mode,
      bucket,
      text,
      createdAt: Number(item.createdAt || Date.now())
    });
  }

  out.sort((a, b) => (b.createdAt - a.createdAt));
  return out;
}

function loadExtraStore() {
  const raw = localStorage.getItem(EXTRA_LS_KEY);
  if (!raw) return [];
  const data = safeParseJSON(raw);
  if (!Array.isArray(data)) return [];
  return normalizeExtraList(data);
}

function saveExtraStore(list) {
  const norm = normalizeExtraList(list);
  localStorage.setItem(EXTRA_LS_KEY, JSON.stringify(norm));
  return norm;
}

function addExtraPhrase(mode, bucket, text) {
  const m = (mode === "fun" ? "fun" : "trivia");
  const b = window.bucket10(bucket);
  const t = String(text || "").trim();
  if (!t) return { ok: false, msg: "ネタが空です" };

  let store = loadExtraStore();
  store.unshift({ id: genId(), mode: m, bucket: b, text: t, createdAt: Date.now() });
  saveExtraStore(store);
  return { ok: true, msg: `追加しました（${m === "fun" ? "お笑い" : "雑学"} / ${b}%）` };
}

function removeExtraById(id) {
  let store = loadExtraStore();
  const before = store.length;
  store = store.filter(x => x.id !== id);
  saveExtraStore(store);
  return { removed: before - store.length };
}

function getExtraItems(mode, bucket) {
  const m = (mode === "fun" ? "fun" : "trivia");
  const b = window.bucket10(bucket);
  const store = loadExtraStore();
  return store.filter(x => x.mode === m && x.bucket === b);
}

// =========================
// 追加ネタ一覧パネル（追加ネタだけ）
// =========================
function renderExtraList() {
  const modeEl = $("listMode");
  const bucketEl = $("listBucket");
  const statusEl = $("listStatus");
  const bodyEl = $("listBody");

  if (!modeEl || !bucketEl || !statusEl || !bodyEl) return;

  const mode = modeEl.value || "trivia";
  const bucket = Number(bucketEl.value || 0);

  const items = getExtraItems(mode, bucket);

  statusEl.textContent = `表示：${mode === "fun" ? "お笑い" : "雑学"} / ${window.bucket10(bucket)}%（${items.length}件）`;
  bodyEl.innerHTML = "";

  if (!items.length) {
    bodyEl.innerHTML = `<div class="muted">この条件の追加ネタはありません。</div>`;
    return;
  }

  for (const it of items) {
    const div = document.createElement("div");
    div.className = "listItem";

    const left = document.createElement("div");
    const text = document.createElement("div");
    text.className = "listText";
    text.textContent = it.text;

    const meta = document.createElement("div");
    meta.className = "listMeta";
    const dt = new Date(it.createdAt);

    const pinMark = isPinned(it.text) ? "　📌公開準備" : "";
    meta.textContent = `追加日: ${dt.toLocaleString()}${pinMark}`;

    left.appendChild(text);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "8px";
    right.style.alignItems = "center";

    const pinBtn = document.createElement("button");
    pinBtn.className = "btnSmall";
    pinBtn.textContent = isPinned(it.text) ? "📌 公開準備を解除" : "📌 公開準備";
    pinBtn.onclick = () => {
      togglePinned(it.text);
      renderExtraList();
      render();
    };
    right.appendChild(pinBtn);

    const btn = document.createElement("button");
    btn.className = "btnSmall";
    btn.textContent = "削除";
    btn.onclick = () => {
      if (!confirm("この追加ネタを削除します。よろしいですか？")) return;
      if (isPinned(it.text)) setPinned(it.text, false);

      removeExtraById(it.id);
      renderExtraList();
      render();
    };
    right.appendChild(btn);

    div.appendChild(left);
    div.appendChild(right);

    bodyEl.appendChild(div);
  }
}

// =========================
// 開閉ボタン（追加ネタ一覧）
// =========================
function setupToggleExtraPanel() {
  const btn = $("toggleExtraList");
  const panel = $("extraListPanel");
  if (!btn || !panel) return;

  const setOpen = (open) => {
    panel.style.display = open ? "block" : "none";
    btn.textContent = open ? "追加ネタ一覧を閉じる ▲" : "追加ネタ一覧を開く ▼";
    btn.dataset.open = open ? "1" : "0";
    if (open) renderExtraList();
  };

  setOpen(false);

  btn.onclick = () => {
    const nowOpen = btn.dataset.open === "1";
    setOpen(!nowOpen);
  };
}

// =========================
// お天気アイコン（%の前）
// =========================
function iconForPop(roundedPop) {
  const p = Number(roundedPop);
  if (p <= 20) return "🌤️";
  if (p <= 60) return "☁️";
  return "🌧️";
}
function setIcon(slotKey, roundedPop) {
  const el = document.getElementById(`wx_${slotKey}`);
  if (!el) return;
  if (roundedPop == null) { el.textContent = "--"; return; }
  el.textContent = iconForPop(roundedPop);
}

// =========================
// ネタ抽選（既存 + 追加 + 共有(JSON) + 共有(public) を混ぜる）
// =========================
const lastPickKey = {};

function getBaseTexts(mode, bucket) {
  bucket = Number(bucket);
  const base = (mode === "trivia"
    ? (window.NETA_TRIVIA?.[bucket] ?? [])
    : (window.NETA?.[bucket] ?? []));
  return base.map(x => String(x || "").trim()).filter(Boolean);
}

function buildCandidatePool(mode, bucket) {
  const b = window.bucket10(bucket);

  const baseTexts = getBaseTexts(mode, b).map(t => ({ text: t, extraId: null }));
  const extras = getExtraItems(mode, b).map(x => ({ text: x.text, extraId: x.id }));
  const shared = getSharedItems(mode, b).map(x => ({ text: x.text, extraId: null }));
  const pub    = getPublicItems(mode, b);

  const out = [];
  const seen = new Set();
  for (const item of [...baseTexts, ...extras, ...shared, ...pub]) {
    if (!item?.text) continue;
    if (seen.has(item.text)) continue;
    seen.add(item.text);
    out.push(item);
  }
  return out;
}

function getShareCounts(mode, bucket) {
  const b = window.bucket10(bucket);

  const jsonSet = new Set(
    getSharedItems(mode, b).map(x => String(x.text || "").trim()).filter(Boolean)
  );

  const pubSet = new Set(
    getPublicItems(mode, b).map(x => String(x.text || "").trim()).filter(Boolean)
  );

  return { json: jsonSet.size, pub: pubSet.size };
}

function weightedPick(items) {
  const weights = items.map(it => {
    const like = (likesData[it.text] || 0);
    const pinBoost = isPinned(it.text) ? 8 : 0;
    return like + pinBoost + 1;
  });

  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;

  for (let i = 0; i < items.length; i++) {
    if (r < weights[i]) return items[i];
    r -= weights[i];
  }
  return items[0];
}

function pickMetaphor(mode, bucket) {
  const b = window.bucket10(bucket);
  const pool = buildCandidatePool(mode, b);
  if (!pool.length) return { text: "データなし", extraId: null };

  const key = `${mode}_${b}`;
  let picked = weightedPick(pool);

  if (pool.length > 1) {
    let attempts = 0;
    while (picked.text === lastPickKey[key] && attempts < 6) {
      picked = weightedPick(pool);
      attempts++;
    }
  }
  lastPickKey[key] = picked.text;
  return picked;
}

// =========================
// 📌 公開準備UI（表示中の3つ）
// =========================
function updateLikeUI(slot) {
  const phraseObj = state.currentPhrases[slot];
  const phrase = phraseObj?.text;

  const countEl = document.getElementById(`likeCount_${slot}`);
  const badgeEl = document.getElementById(`badge_${slot}`);
  const btnEl = document.getElementById(`like_${slot}`);

  if (!phrase) {
    if (countEl) countEl.textContent = "0";
    if (badgeEl) badgeEl.textContent = "";
    if (btnEl) { btnEl.disabled = true; btnEl.onclick = null; btnEl.textContent = "📌 公開準備"; }
    return;
  }

  const count = getLikesFor(phrase);
  if (countEl) countEl.textContent = String(count);

  const pinned = isPinned(phrase);
  if (badgeEl) {
    if (pinned) badgeEl.textContent = "📌公開準備";
    else badgeEl.textContent = count >= 5 ? "⭐候補！" : "";
  }

  if (btnEl) {
    btnEl.disabled = false;
    btnEl.textContent = pinned ? "📌 公開準備を解除" : "📌 公開準備";
    btnEl.onclick = () => {
      togglePinned(phrase);
      if (!pinned) incrementLike(phrase); // 公開準備にしたときだけカウント
      updateLikeUI(slot);
      renderExtraList();
      render();
    };
  }
}

// =========================
// 「このネタを削除」（表示中の追加ネタだけ）
// =========================
function updateDeleteUI(slotKey) {
  const btn = document.getElementById(`del_${slotKey}`);
  if (!btn) return;

  const extraId = state.currentPhrases[slotKey]?.extraId || null;

  if (!extraId) {
    btn.style.display = "none";
    btn.onclick = null;
    return;
  }

  btn.style.display = "inline-block";
  btn.onclick = () => {
    if (!confirm("この追加ネタを削除します。よろしいですか？")) return;

    const txt = state.currentPhrases[slotKey]?.text;
    if (txt && isPinned(txt)) setPinned(txt, false);

    removeExtraById(extraId);
    renderExtraList();
    render();
  };
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

      state.currentPhrases[slotKey] = { text: null, extraId: null };
      updateLikeUI(slotKey);
      updateDeleteUI(slotKey);
      return null;
    }

    const rounded = window.bucket10(value);
    if (popEl) popEl.textContent = `${rounded}%`;

    setIcon(slotKey, rounded);

    const mode = getSelectedMode();

    const picked = pickMetaphor(mode, rounded);

    const sc = getShareCounts(mode, rounded);
    const shareHint = `（共有public:${sc.pub}件 / 共有JSON:${sc.json}件）`;

    if (metaEl) metaEl.textContent = `${label}：${picked.text} ${shareHint}`;

    state.currentPhrases[slotKey] = { text: picked.text, extraId: picked.extraId };
    updateLikeUI(slotKey);
    updateDeleteUI(slotKey);

    // テーマ適用（降水確率に応じて）
    try { applyTheme(rounded); } catch {}

    return { value: rounded, text: picked.text, label };
  };

  if (!state.pops) {
    if (hintEl) hintEl.textContent = "地点を選ぶと自動取得します";
    renderEmpty();
    if (footEl) footEl.textContent = "";
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
    "※降水確率を0/10/…/100%に丸め、既存ネタ＋追加ネタ＋共有(JSON)＋共有(public)候補からランダム表示（📌公開準備が多いほど出やすい）";
}

function renderEmpty() {
  const metaAll = document.getElementById("metaphor");

  ["m","d","e"].forEach(k => {
    const popEl = document.getElementById(`pop_${k}`);
    const metaEl = document.getElementById(`meta_${k}`);

    if (popEl) popEl.textContent = "--%";
    if (metaEl) metaEl.textContent = "データなし";

    setIcon(k, null);

    state.currentPhrases[k] = { text: null, extraId: null };
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
      render();
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

        render();
      } catch (e) {
        setStatus(e.message || "天気取得エラー", "ng");
        state.source = "API: エラー";
        state.pops = null;
        render();
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
    render();
  })
);

document.getElementById("refresh").onclick = () => render();

if ($("listMode")) $("listMode").addEventListener("change", renderExtraList);
if ($("listBucket")) $("listBucket").addEventListener("change", renderExtraList);

// ==============================
// ネタ追加（送信は“キューに貯める”）
// ==============================
document.getElementById("addPhraseBtn").onclick = async () => {
  const statusEl = document.getElementById("addStatus");
  const mode = ($("newPhraseMode")?.value ?? "trivia");
  const bucketRaw = Number($("newPhraseBucket")?.value ?? 0);
  const bucket = window.bucket10(bucketRaw);
  const text = (document.getElementById("newPhrase")?.value ?? "").trim();

  const res = addExtraPhrase(mode, bucket, text);

  if (statusEl) statusEl.textContent = res.ok ? `✅ ${res.msg}` : `⚠️ ${res.msg}`;
  if (res.ok && document.getElementById("newPhrase")) document.getElementById("newPhrase").value = "";

  // ✅ ここが変更点：iPhone連続POST対策のため「即送信せず」キューに貯める
  if (res.ok) {
    const qres = queueForPending(mode, bucket, text);
    updateSendBtnLabel();
    if (statusEl) {
      statusEl.textContent =
        `✅ ${res.msg}\n📌 公開のための送信待ちに入れました（${queueCount()}件）\n👉 右の「📨 承認待ちへ送信」を押すと、1件ずつ安全に送ります。`;
    }
  }

  renderExtraList();
  render();
};

// ==============================
// 初期化
// ==============================
setupToggleExtraPanel();
ensureSendBtn();          // ✅ 送信ボタンを自動生成
updateSendBtnLabel();     // ✅ キュー件数反映
render();

loadSharedJSON().then(() => {
  render();
});

// ==============================
// Theme (Gradient) by precipitation
// ==============================
function themeFromPercent(p){
  if (p <= 10)  return { bg1:"#fff7d6", bg2:"#ffffff", accent:"#f59e0b" };
  if (p <= 30)  return { bg1:"#e8f6ff", bg2:"#ffffff", accent:"#38bdf8" };
  if (p <= 50)  return { bg1:"#eaf0ff", bg2:"#f8fafc", accent:"#60a5fa" };
  if (p <= 70)  return { bg1:"#dbeafe", bg2:"#eff6ff", accent:"#2563eb" };
  if (p <= 90)  return { bg1:"#c7d2fe", bg2:"#e0e7ff", accent:"#1d4ed8" };
  return          { bg1:"#e9d5ff", bg2:"#0b1220", accent:"#a855f7" }; // 100%
}

function applyTheme(p){
  const t = themeFromPercent(Number(p));
  const root = document.documentElement;

  root.style.setProperty("--bg1", t.bg1);
  root.style.setProperty("--bg2", t.bg2);
  root.style.setProperty("--accent", t.accent);

  if (Number(p) >= 100) {
    root.style.setProperty("--text", "#f9fafb");
    root.style.setProperty("--sub", "rgba(249,250,251,0.75)");
    root.style.setProperty("--card", "rgba(17,24,39,0.55)");
    root.style.setProperty("--shadow", "0 14px 30px rgba(0,0,0,0.45)");
  } else {
    root.style.setProperty("--text", "#0f172a");
    root.style.setProperty("--sub", "#475569");
    root.style.setProperty("--card", "rgba(255,255,255,0.86)");
    root.style.setProperty("--shadow", "0 10px 26px rgba(0,0,0,0.10)");
  }
}
// ==============================
// ネタ一覧（公開）表示 & ローカル非表示 & サーバ削除（任意）
// 既存機能は触らず、UIだけ増やす
// ==============================
(() => {
  const LS_HIDE_KEY = "hidden_public_ids_v1";

  const $ = (sel, root = document) => root.querySelector(sel);

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function loadHidden() {
    try {
      const raw = localStorage.getItem(LS_HIDE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? new Set(arr) : new Set();
    } catch {
      return new Set();
    }
  }
  function saveHidden(set) {
    localStorage.setItem(LS_HIDE_KEY, JSON.stringify([...set]));
  }

  // 既存のUIに差し込む（なければbody末尾に作る）
  function ensurePanel() {
    let panel = document.getElementById("metaphorListPanel");
    if (panel) return panel;

    panel = document.createElement("section");
    panel.id = "metaphorListPanel";
    panel.style.marginTop = "14px";
    panel.style.padding = "14px";
    panel.style.border = "1px solid rgba(15,23,42,0.12)";
    panel.style.borderRadius = "16px";
    panel.style.background = "rgba(255,255,255,0.86)";

    panel.innerHTML = `
      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <div style="font-weight:700;">📚 公開ネタ一覧</div>
        <button id="btnReloadPublic" style="padding:10px 12px; border-radius:12px; border:1px solid rgba(15,23,42,0.16); background:#fff; cursor:pointer;">
          再読み込み
        </button>
        <label style="display:flex; align-items:center; gap:8px; font-size:13px; color:#475569;">
          <input type="checkbox" id="chkShowHidden" />
          非表示も表示
        </label>
        <input id="adminKeyInput" placeholder="（任意）管理キー x-admin-key"
          style="padding:10px 12px; border-radius:12px; border:1px solid rgba(15,23,42,0.16); background:#fff; min-width:260px;"/>
      </div>

      <div style="margin-top:10px; font-size:12px; color:#64748b;">
        ・「非表示」はこの端末だけ。全員から消すには管理キー＋削除APIが必要。
      </div>

      <div id="publicListStatus" style="margin-top:10px; color:#475569; font-size:13px;"></div>
      <div id="publicListBox" style="margin-top:10px; display:grid; gap:10px;"></div>
    `;

    // どこに入れるか：#app があればその中、なければ body 末尾
    const host = document.getElementById("app") || document.body;
    host.appendChild(panel);
    return panel;
  }

  // 既存の「今選択中の mode / bucket」を取れたら取る（なければ全部）
  function guessCurrentModeBucket() {
    // ここはあなたの既存UIに合わせて調整しやすいように「推測」で書いてます
    // 例：modeラジオ: input[name="mode"]:checked, bucketセレクト: #bucketSelect
    const modeEl = document.querySelector('input[name="mode"]:checked');
    const bucketEl = document.getElementById("bucketSelect") || document.querySelector('select[name="bucket"]');
    const mode = modeEl ? modeEl.value : null;
    const bucket = bucketEl ? Number(bucketEl.value) : null;
    return { mode, bucket: Number.isFinite(bucket) ? bucket : null };
  }

  async function fetchPublicList({ mode, bucket, limit = 200 } = {}) {
    // すでにあなたの script.js にある fetchPublicMetaphors() が使えるならそれを優先
    if (typeof fetchPublicMetaphors === "function") {
      return await fetchPublicMetaphors({ mode, bucket, limit });
    }

    // ない場合のフォールバック（API_BASE は既存定義を想定）
    const params = new URLSearchParams();
    if (mode) params.set("mode", mode);
    if (Number.isFinite(bucket)) params.set("bucket", String(bucket));
    params.set("limit", String(limit));
    const url = `${API_BASE}/api/public?${params.toString()}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) throw new Error(data?.error || `public fetch failed ${res.status}`);
    return data.items || [];
  }

  async function adminDeletePublic({ id, adminKey }) {
    // Workers側に /api/admin/delete を追加してある前提（後述）
    const res = await fetch(`${API_BASE}/api/admin/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": adminKey || "",
      },
      body: JSON.stringify({ id }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) throw new Error(data?.error || `delete failed ${res.status}`);
    return data;
  }

  function renderItems(items, { showHidden, hiddenSet, adminKey } = {}) {
    const box = document.getElementById("publicListBox");
    if (!box) return;

    box.innerHTML = "";

    // 並び：新しい順っぽく（createdAtがあるなら）
    const sorted = [...items].sort((a, b) => {
      const ta = Number(a?.createdAt || 0);
      const tb = Number(b?.createdAt || 0);
      return tb - ta;
    });

    const view = sorted.filter(it => {
      const id = it?.id ?? it?._id ?? it?.key ?? it?.text; // idが無い場合の保険
      const isHidden = hiddenSet.has(String(id));
      return showHidden ? true : !isHidden;
    });

    if (view.length === 0) {
      box.innerHTML = `<div style="color:#64748b; font-size:13px;">表示できるネタがありません。</div>`;
      return;
    }

    for (const it of view) {
      const id = it?.id ?? it?._id ?? it?.key ?? it?.text;
      const text = it?.text ?? "";
      const mode = it?.mode ?? "";
      const bucket = (it?.bucket ?? it?.prob ?? "");
      const createdAt = it?.createdAt ? new Date(it.createdAt).toLocaleString("ja-JP") : "";

      const isHidden = hiddenSet.has(String(id));

      const card = document.createElement("div");
      card.style.border = "1px solid rgba(15,23,42,0.10)";
      card.style.borderRadius = "14px";
      card.style.padding = "12px";
      card.style.background = "rgba(255,255,255,0.95)";
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
          <div style="flex:1; min-width:0;">
            <div style="font-size:14px; line-height:1.5; color:#0f172a; word-break:break-word;">
              ${escapeHtml(text)}
            </div>
            <div style="margin-top:6px; font-size:12px; color:#64748b;">
              ${escapeHtml(mode)} / ${escapeHtml(bucket)} ${createdAt ? " / " + escapeHtml(createdAt) : ""}
            </div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
            <button data-action="hide" data-id="${escapeHtml(String(id))}"
              style="padding:9px 10px; border-radius:12px; border:1px solid rgba(15,23,42,0.16); background:#fff; cursor:pointer;">
              ${isHidden ? "非表示解除" : "非表示"}
            </button>
            <button data-action="delete" data-id="${escapeHtml(String(id))}"
              style="padding:9px 10px; border-radius:12px; border:1px solid rgba(15,23,42,0.16); background:#fff; cursor:pointer; display:${adminKey ? "inline-block" : "none"};">
              管理削除
            </button>
          </div>
        </div>
      `;

      // ボタン動作
      card.addEventListener("click", async (ev) => {
        const btn = ev.target?.closest("button");
        if (!btn) return;
        const action = btn.dataset.action;
        const cid = btn.dataset.id;

        if (action === "hide") {
          if (hiddenSet.has(cid)) hiddenSet.delete(cid);
          else hiddenSet.add(cid);
          saveHidden(hiddenSet);
          // 即反映
          const chk = document.getElementById("chkShowHidden");
          const showHidden2 = !!chk?.checked;
          renderItems(items, { showHidden: showHidden2, hiddenSet, adminKey });
        }

        if (action === "delete") {
          if (!adminKey) {
            alert("管理キーが未入力です。");
            return;
          }
          const ok = confirm("このネタをサーバから削除します。全員から見えなくなります。よろしいですか？");
          if (!ok) return;

          try {
            btn.disabled = true;
            btn.textContent = "削除中…";
            await adminDeletePublic({ id: cid, adminKey });
            // 成功したらローカル一覧からも除外するため再読込
            await reload();
          } catch (e) {
            alert(`削除に失敗: ${e?.message || e}`);
          } finally {
            btn.disabled = false;
            btn.textContent = "管理削除";
          }
        }
      });

      box.appendChild(card);
    }
  }

  async function reload() {
    const status = document.getElementById("publicListStatus");
    const chk = document.getElementById("chkShowHidden");
    const keyInput = document.getElementById("adminKeyInput");

    const { mode, bucket } = guessCurrentModeBucket();
    const showHidden = !!chk?.checked;
    const adminKey = (keyInput?.value || "").trim();
    const hiddenSet = loadHidden();

    try {
      if (status) status.textContent = "読み込み中…";
      const items = await fetchPublicList({ mode, bucket, limit: 200 });
      if (status) status.textContent = `公開ネタ：${items.length}件（${mode ?? "全モード"} / ${bucket ?? "全バケット"}）`;
      renderItems(items, { showHidden, hiddenSet, adminKey });
    } catch (e) {
      if (status) status.textContent = `読み込み失敗: ${e?.message || e}`;
    }
  }

  // init
  ensurePanel();
  document.getElementById("btnReloadPublic")?.addEventListener("click", reload);
  document.getElementById("chkShowHidden")?.addEventListener("change", reload);
  // 管理キー入力は即時反映しなくてOK（再読み込みで反映）
  reload();
})();
// ==============================
// ✅ クリック不能（鉛筆/ボタンが押せない）対策：強制前面化
// - 既存機能は一切触らない
// - 被せ要素が原因でも押せる確率を上げる
// ==============================
(() => {
  if (document.getElementById("__force_click_fix__")) return;

  const st = document.createElement("style");
  st.id = "__force_click_fix__";
  st.textContent = `
    /* ボタン類は必ずクリック可能に */
    button, a, input, label { pointer-events: auto !important; }

    /* 追加ネタ一覧のボタン/小ボタンも前面に */
    .btnSmall, .btnPrimary { position: relative !important; z-index: 9999 !important; }

    /* 公開ネタ一覧パネルのボタンを前面に */
    #metaphorListPanel button { position: relative !important; z-index: 9999 !important; }

    /* 何かがカードの上に被っていても“ボタン上”は拾えるように */
    #publicListBox, #publicListBox * { pointer-events: auto !important; }

    /* 不要な疑似要素がクリックを奪う事故を防ぐ */
    #publicListBox *::before, #publicListBox *::after { pointer-events: none !important; }
  `;
  document.head.appendChild(st);
})();

// # END
