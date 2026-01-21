// =========================
// 天気取得：Open-Meteo
// =========================
// ★保険：metaphors.js が読めてなくても落ちないようにする
window.bucket10 = window.bucket10 || function (p) {
  p = Math.max(0, Math.min(100, Number(p)));
  const b = Math.round(p / 10) * 10;
  return Math.max(0, Math.min(100, b));
};
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
// ユーザー追加ネタ（localStorage）
// - 雑学: NETA_TRIVIA に追加
// - お笑い: NETA に追加
// =========================
const USER_NETA_KEY = "userNetaV1";

function loadUserNeta() {
  try {
    const obj = JSON.parse(localStorage.getItem(USER_NETA_KEY) || "{}");
    // 期待形：{ trivia:{0:[...],10:[...]...}, fun:{...} }
    return {
      trivia: obj.trivia || {},
      fun: obj.fun || {}
    };
  } catch (e) {
    return { trivia: {}, fun: {} };
  }
}

function saveUserNeta(obj) {
  localStorage.setItem(USER_NETA_KEY, JSON.stringify(obj));
}

let userNeta = loadUserNeta();

function normalizeBucketInput(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const b = window.bucket10 ? window.bucket10(n) : (Math.round(n / 10) * 10);
  if (![0,10,20,30,40,50,60,70,80,90,100].includes(b)) return null;
  return b;
}

function addUserNeta(mode, bucket, text) {
  function deleteUserNeta(mode, bucket, text) {
  const key = (mode === "trivia") ? "trivia" : "fun";
  const arr = userNeta[key]?.[bucket];
  if (!arr || !arr.length) return;

  userNeta[key][bucket] = arr.filter(t => t !== text);
  if (userNeta[key][bucket].length === 0) {
    delete userNeta[key][bucket];
  }
  saveUserNeta(userNeta);
}

function clearUserNetaBucket(mode, bucket) {
  const key = (mode === "trivia") ? "trivia" : "fun";
  if (userNeta[key]?.[bucket]) {
    delete userNeta[key][bucket];
    saveUserNeta(userNeta);
  }
}

function clearUserNetaAll() {
  userNeta = { trivia: {}, fun: {} };
  saveUserNeta(userNeta);
}

  const key = (mode === "trivia") ? "trivia" : "fun";
  if (!userNeta[key][bucket]) userNeta[key][bucket] = [];
  // 同一文の重複は入れない（好みで外してOK）
  if (!userNeta[key][bucket].includes(text)) {
    userNeta[key][bucket].push(text);
    saveUserNeta(userNeta);
  }
}

// 取得：組み込み + 追加 を合体して返す
function getPool(mode, bucket) {
  const b = Number(bucket);
  const base = (mode === "trivia")
    ? (window.NETA_TRIVIA?.[b] ?? [])
    : (window.NETA?.[b] ?? []);

  const extra = (mode === "trivia")
    ? (userNeta.trivia?.[b] ?? [])
    : (userNeta.fun?.[b] ?? []);

  // base→extra の順で合体（表示/抽選は同列）
  return [...base, ...extra];
}

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
function getSelectedMode() {
  const el = document.querySelector('input[name="mode"]:checked');
  return el ? el.value : "trivia"; // デフォルトは雑学
}

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
    bucket = Number(bucket); // ★追加：必ず数値にする
  const mode = getSelectedMode();
const pool = getPool(mode, bucket);

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
// 降水確率(0-100)から天気アイコンを決める（簡易版）
function iconForPop(pop) {
  if (pop == null) return "";
  const p = Number(pop);
  if (p <= 20) return "☀️";
  if (p <= 60) return "☁️";
  return "☔";
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

const rounded = bucket10(value);   // ★ 0,10,20,...に丸める
const icon = iconForPop(rounded);
popEl.textContent = `${icon} ${rounded}%`;


const text = metaphorForPop(rounded);
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
    if (hour >= 6 && hour <= 11) bucket.m.push(p);
    else if (hour >= 12 && hour <= 17) bucket.d.push(p);
    else if (hour >= 18 && hour <= 23) bucket.e.push(p);
  }

  const maxOrNull = (arr) => arr.length ? Math.round(Math.max(...arr)) : null;

  return {
    pops: {
      m: maxOrNull(bucket.m),
      d: maxOrNull(bucket.d),
      e: maxOrNull(bucket.e),
    },
    tz
  };
}

// UI: 検索→候補表示
document.getElementById("search").onclick = async () => {
  const raw = document.getElementById("place").value.trim();
  const q = normalizePlaceName(raw);

  const sel = document.getElementById("candidates");
  sel.innerHTML = "";
  sel.disabled = true;

  if (!q) {
    setStatus("地点名を入力してください", "ng");
    return;
  }

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

// モード変更はA版では render を呼ぶだけ（表示を更新したいので残す）
document.querySelectorAll('input[name="mode"]').forEach(r =>
  r.addEventListener("change", render)
);

// 「同じ確率でも例えを変える」ボタン
document.getElementById("refresh").onclick = () => render();

// ネタ追加ボタン（実装版）
document.getElementById("addPhraseBtn").onclick = () => {
  function deleteUserNeta(mode, bucket, text) {
  const key = (mode === "trivia") ? "trivia" : "fun";
  const arr = userNeta[key]?.[bucket];
  if (!arr || !arr.length) return;

  userNeta[key][bucket] = arr.filter(t => t !== text);
  if (userNeta[key][bucket].length === 0) {
    delete userNeta[key][bucket];
  }
  saveUserNeta(userNeta);
}

function clearUserNetaBucket(mode, bucket) {
  const key = (mode === "trivia") ? "trivia" : "fun";
  if (userNeta[key]?.[bucket]) {
    delete userNeta[key][bucket];
    saveUserNeta(userNeta);
  }
}

function clearUserNetaAll() {
  userNeta = { trivia: {}, fun: {} };
  saveUserNeta(userNeta);
}

  const statusEl = document.getElementById("addStatus");
  const modeEl = document.getElementById("newPhraseMode");
  const bucketEl = document.getElementById("newPhraseBucket");
  const textEl = document.getElementById("newPhrase");

  const mode = modeEl ? modeEl.value : "trivia";
  const bucket = normalizeBucketInput(bucketEl ? bucketEl.value : "");
  const text = (textEl ? textEl.value : "").trim();

  if (!bucket && bucket !== 0) {
    statusEl.textContent = "確率（0/10/…/100）を選んでください";
    return;
  }
  if (!text) {
    statusEl.textContent = "ネタ本文を入力してください";
    return;
  }

  addUserNeta(mode, bucket, text);
  textEl.value = "";
  statusEl.textContent = `追加しました：${mode === "trivia" ? "雑学" : "お笑い"} / ${bucket}%`;
  render();
};


// END
