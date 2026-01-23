// script.js
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
// いいね
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
    meta.textContent = `追加日: ${dt.toLocaleString()}`;

    left.appendChild(text);
    left.appendChild(meta);

    const right = document.createElement("div");
    const btn = document.createElement("button");
    btn.className = "btnSmall";
    btn.textContent = "削除";
    btn.onclick = () => {
      if (!confirm("この追加ネタを削除します。よろしいですか？")) return;
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
    if (open) renderExtraList(); // 開いた瞬間に最新表示
  };

  // 初期は閉じる
  setOpen(false);

  btn.onclick = () => {
    const nowOpen = btn.dataset.open === "1";
    setOpen(!nowOpen);
  };
}

// =========================
// お天気アイコン（%の前）
// 0–20: 🌤️ / 30–60: ☁️ / 70–100: 🌧️
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
// ネタ抽選（既存 + 追加 を混ぜる）
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

  const out = [];
  const seen = new Set();
  for (const item of [...baseTexts, ...extras]) {
    if (seen.has(item.text)) continue;
    seen.add(item.text);
    out.push(item);
  }
  return out;
}

function weightedPick(items) {
  const weights = items.map(it => (likesData[it.text] || 0) + 1);
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
// いいねUI
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
    if (btnEl) { btnEl.disabled = true; btnEl.onclick = null; }
    return;
  }

  const count = getLikesFor(phrase);
  if (countEl) countEl.textContent = String(count);
  if (badgeEl) badgeEl.textContent = count >= 5 ? "⭐人気！" : "";

  if (btnEl) {
    btnEl.disabled = false;
    btnEl.onclick = () => {
      incrementLike(phrase);
      updateLikeUI(slot);
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
    removeExtraById(extraId);
    // 開いていれば一覧も更新
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

    const rounded = window.bucket10(value); // ★安全に統一
    if (popEl) popEl.textContent = `${rounded}%`;

    setIcon(slotKey, rounded);

    const mode = getSelectedMode();
    const picked = pickMetaphor(mode, rounded);
    if (metaEl) metaEl.textContent = `${label}：${picked.text}`;

    state.currentPhrases[slotKey] = { text: picked.text, extraId: picked.extraId };
    updateLikeUI(slotKey);
    updateDeleteUI(slotKey);

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

  if (footEl) footEl.textContent = "※降水確率を0/10/…/100%に丸め、既存ネタ＋追加ネタ候補からランダム表示（👍が多いほど出やすい）";
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
    pops: {
      m: maxOrNull(bucket.m),
      d: maxOrNull(bucket.d),
      e: maxOrNull(bucket.e),
    },
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

// モード変更は render
document.querySelectorAll('input[name="mode"]').forEach(r =>
  r.addEventListener("change", render)
);

// 「同じ確率でも例えを変える」
document.getElementById("refresh").onclick = () => render();

// 一覧フィルタ変更
if ($("listMode")) $("listMode").addEventListener("change", renderExtraList);
if ($("listBucket")) $("listBucket").addEventListener("change", renderExtraList);

// ネタ追加
document.getElementById("addPhraseBtn").onclick = () => {
  const statusEl = document.getElementById("addStatus");
  const mode = ($("newPhraseMode")?.value ?? "trivia");
  const bucket = Number($("newPhraseBucket")?.value ?? 0);
  const text = (document.getElementById("newPhrase")?.value ?? "").trim();

  const res = addExtraPhrase(mode, bucket, text);

  if (statusEl) statusEl.textContent = res.ok ? `✅ ${res.msg}` : `⚠️ ${res.msg}`;
  if (res.ok && document.getElementById("newPhrase")) document.getElementById("newPhrase").value = "";

  // 開いていれば一覧も更新
  renderExtraList();
  render();
};

// 初期化
setupToggleExtraPanel();
render();

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

  // 100%のときだけ暗め背景 → 文字を白寄りに
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

// # END
