// =========================
// 天気取得：Open-Meteo
// =========================
const GEO = "https://geocoding-api.open-meteo.com/v1/search";
const FC  = "https://api.open-meteo.com/v1/forecast";

let state = {
  pops: null,         // { m: number|null, d: number|null, e: number|null }
  placeLabel: null,
  tz: null,
  source: "API: 未接続",
  currentPhrases: { m: null, d: null, e: null }
};

// =========================
// いいね（既存機能を維持）
// =========================
const LIKES_KEY = "metaphorLikes";

function loadLikes() {
  try { return JSON.parse(localStorage.getItem(LIKES_KEY) || '{}'); }
  catch (e) { return {}; }
}
function saveLikes(obj) { localStorage.setItem(LIKES_KEY, JSON.stringify(obj)); }

let likesData = loadLikes();

function getLikesFor(phrase) { return likesData[phrase] || 0; }
function incrementLike(phrase) {
  likesData[phrase] = (likesData[phrase] || 0) + 1;
  saveLikes(likesData);
}

// =========================
// A版：ネタ選択（0/10/.../100のバケット × 各3ネタ）
// 👍が多いほど出やすい + 直前回避
// =========================
const lastSeedByBucket = {};

function pickSeedByBucket(bucket) {
  const pool = (window.NETA && window.NETA[bucket]) ? window.NETA[bucket] : [];
  if (!pool.length) return "データなし";

  const weights = pool.map(t => (likesData[t] || 0) + 1);
  const total = weights.reduce((a, b) => a + b, 0);

  let r = Math.random() * total;
  let picked = pool[0];
  for (let i = 0; i < pool.length; i++) {
    if (r < weights[i]) { picked = pool[i]; break; }
    r -= weights[i];
  }

  const key = String(bucket);
  if (pool.length > 1) {
    let attempts = 0;
    while (picked === lastSeedByBucket[key] && attempts < 5) {
      picked = pool[Math.floor(Math.random() * pool.length)];
      attempts++;
    }
  }
  lastSeedByBucket[key] = picked;
  return picked;
}

// pop% → bucket10 → seed
function metaphorForPop(pop) {
  const b = bucket10(pop);
  return pickSeedByBucket(b);
}

// =========================
// いいねUI更新（既存を維持）
// =========================
function updateLikeUI(slot) {
  const phrase = state.currentPhrases[slot];
  const countEl = document.getElementById(`likeCount_${slot}`);
  const badgeEl = document.getElementById(`badge_${slot}`);
  const btnEl = document.getElementById(`like_${slot}`);

  if (!phrase) {
    countEl.textContent = "0";
    badgeEl.textContent = "";
    if (btnEl) { btnEl.disabled = true; btnEl.onclick = null; }
    return;
  }

  const count = getLikesFor(phrase);
  countEl.textContent = String(count);
  badgeEl.textContent = count >= 5 ? "⭐人気！" : "";

  if (btnEl) {
    btnEl.disabled = false;
    btnEl.onclick = () => {
      incrementLike(phrase);
      updateLikeUI(slot);
    };
  }
}

function setStatus(text, kind="muted") {
  const el = document.getElementById("placeStatus");
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

function render() {
  const hintEl = document.getElementById("popHint");
  const sourceTag = document.getElementById("sourceTag");
  const tzTag = document.getElementById("tzTag");

  const metaAll = document.getElementById("metaphor");
  const footEl = document.getElementById("metaFoot");

  sourceTag.textContent = state.source;
  tzTag.textContent = state.tz ? `TZ: ${state.tz}` : "TZ: --";

  const setSlot = (idPop, idMeta, value, label, slotKey) => {
    const popEl = document.getElementById(idPop);
    const metaEl = document.getElementById(idMeta);

    if (value == null) {
      popEl.textContent = "--%";
      metaEl.textContent = "データなし";
      state.currentPhrases[slotKey] = null;
      updateLikeUI(slotKey);
      return null;
    }

    popEl.textContent = `${value}%`;
    const text = metaphorForPop(value); // ★ 新仕様
    metaEl.textContent = `${label}：${text}`;

    state.currentPhrases[slotKey] = text;
    updateLikeUI(slotKey);

    return { value, text, label };
  };

  if (!state.pops) {
    hintEl.textContent = "地点を選ぶと自動取得します";
    renderEmpty();
    footEl.textContent = "";
    return;
  }

  hintEl.textContent = state.placeLabel ? `地点：${state.placeLabel}` : "地点：--";

  const a = setSlot("pop_m", "meta_m", state.pops.m, "朝", "m");
  const b = setSlot("pop_d", "meta_d", state.pops.d, "昼", "d");
  const c = setSlot("pop_e", "meta_e", state.pops.e, "夜", "e");

  const candidates = [a, b, c].filter(Boolean);
  if (!candidates.length) {
    metaAll.textContent = "データが取得できませんでした（別地点で試してください）";
  } else {
    const maxOne = candidates.reduce((x, y) => (y.value > x.value ? y : x));
    metaAll.textContent = `今日いちばん怪しいのは【${maxOne.label}】：${maxOne.value}% → ${maxOne.text}`;
  }

  footEl.textContent = "※降水確率を0/10/…/100%に丸め、候補3つからランダム表示（👍が多いほど出やすい）";
}

function renderEmpty() {
  const metaAll = document.getElementById("metaphor");
  document.getElementById("pop_m").textContent = "--%";
  document.getElementById("meta_m").textContent = "データなし";
  document.getElementById("pop_d").textContent = "--%";
  document.getElementById("meta_d").textContent = "データなし";
  document.getElementById("pop_e").textContent = "--%";
  document.getElementById("meta_e").textContent = "データなし";
  metaAll.textContent = "地点を選んでください";

  state.currentPhrases.m = null;
  state.currentPhrases.d = null;
  state.currentPhrases.e = null;
  updateLikeUI('m');
  updateLikeUI('d');
  updateLikeUI('e');
}

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
    if (hour >=
