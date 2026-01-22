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
  // ★表示中ネタ（削除に備え、extraId も保持）
  currentPhrases: { 
    m: { text: null, extraId: null }, 
    d: { text: null, extraId: null }, 
    e: { text: null, extraId: null } 
  }
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

function getSelectedMode() {
  const el = document.querySelector('input[name="mode"]:checked');
  return el ? el.value : "trivia"; // デフォルトは雑学
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

const $ = (id) => document.getElementById(id);

function genId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function safeParseJSON(raw) {
  try { return JSON.parse(raw); } catch { return null; }
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

function normalizeExtraList(list) {
  const out = [];
  const seen = new Set();

  for (const item of (list || [])) {
    if (!item) continue;

    const mode = (item.mode === "fun" ? "fun" : "trivia");
    const bucket = window.bucket10(Number(item.bucket));
    const text = String(item.text || "").trim();
    if (!text) continue;

    // 同一内容は mode+bucket+text で重複排除
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

  // 新しい順
  out.sort((a, b) => (b.createdAt - a.createdAt));
  return out;
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

// 管理UI（今のUIは「ネタ追加」の選択を流用）
function getManageMode() {
  const el = $("newPhraseMode");
  return el ? el.value : "trivia";
}
function getManageBucket() {
  const el = $("newPhraseBucket");
  return el ? Number(el.value) : 0;
}

// =========================
// お天気アイコン（%の前）
// 0–20: 🌤️ / 30–60: ☁️ / 70–100: 🌧️
// ※表示は10刻みなので 20→🌤️、30→☁️、70→🌧️ が効く
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
// A版：ネタ選択
// ✅ 既存ネタ + 追加ネタを「固定割合なし」で混ぜる
//   → 候補配列を結合して抽選（候補数と👍で自然に混ざる）
// 👍が多いほど出やすい + 直前回避（同じbucket連発回避）
// =========================
const lastPickKey = {};

function getBaseTexts(mode, bucket) {
  bucket = Number(bucket);
  const base = (mode === "trivia"
    ? (window.NETA_TRIVIA?.[bucket] ?? [])
    : (window.NETA?.[bucket] ?? []));
  // 文字列の正規化
  return base.map(x => String(x || "").trim()).filter(Boolean);
}

function buildCandidatePool(mode, bucket) {
  const b = window.bucket10(bucket);

  // 既存ネタ
  const baseTexts = getBaseTexts(mode, b).map(t => ({ text: t, extraId: null }));

  // 追加ネタ（id付き）
  const extras = getExtraItems(mode, b).map(x => ({ text: x.text, extraId: x.id }));

  // 結合＋同文重複排除（既存と追加で同文があっても1つにする）
  const out = [];
  const seen = new Set();
  for (const item of [...baseTexts, ...extras]) {
    const key = item.text; // text重複は1つに（extraIdは保持できないので、重複時は先勝ち）
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function weightedPick(items) {
  // 👍重み: likes+1（text単位）
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

  // 直前回避：同じ mode+bucket で連続同文を避ける
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

  return picked; // {text, extraId}
}

// =========================
// いいねUI更新（既存を維持）
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
// 「このネタを削除」ボタン制御
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

    // 削除したら再抽選して即反映
    render();
  };
}

// =========================
// UI helpers
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

    const rounded = bucket10(value); // 0,10,20,...に丸める
    if (popEl) popEl.textContent = `${rounded}%`;

    // ★アイコン（%の前）
    setIcon(slotKey, rounded);

    // ★ネタ抽選（固定割合なしで混ぜる＝候補結合して抽選）
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

// モード変更は render を呼ぶだけ（表示を更新したいので残す）
document.querySelectorAll('input[name="mode"]').forEach(r =>
  r.addEventListener("change", render)
);

// 「同じ確率でも例えを変える」ボタン
document.getElementById("refresh").onclick = () => render();

// =========================
// ネタ追加ボタン（localStorageへ保存）
// =========================
document.getElementById("addPhraseBtn").onclick = () => {
  const statusEl = document.getElementById("addStatus");
  const mode = getManageMode();
  const bucket = getManageBucket();
  const text = (document.getElementById("newPhrase")?.value ?? "").trim();

  const res = addExtraPhrase(mode, bucket, text);

  if (statusEl) statusEl.textContent = res.ok ? `✅ ${res.msg}` : `⚠️ ${res.msg}`;
  if (res.ok && document.getElementById("newPhrase")) document.getElementById("newPhrase").value = "";

  // 追加後は表示も更新（追加ネタが混ざるので）
  render();
};

// Service Worker登録（PWA）
//if ("serviceWorker" in navigator) {
//  navigator.serviceWorker.register("./sw.js", { scope: "./" });
//}

render();

// END
