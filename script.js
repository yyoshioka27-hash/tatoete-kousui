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
// 追加ネタ（ローカル保存）
// =========================
const CUSTOM_KEY = "tatoete_custom_neta_v1";

function loadCustom() {
  try {
    const obj = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "{}");
    obj.trivia = obj.trivia || {};
    obj.fun = obj.fun || {};
    return obj;
  } catch (e) {
    return { trivia: {}, fun: {} };
  }
}
function saveCustom(obj) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(obj));
}

// mode("trivia"/"fun") + bucket(0..100) で、表示用のプールを作る
function getPool(mode, bucket) {
  bucket = Number(bucket);

  const base = (mode === "trivia")
    ? (window.NETA_TRIVIA?.[bucket] ?? [])
    : (window.NETA?.[bucket] ?? []);

  const custom = loadCustom();
  const added = (custom[mode] && custom[mode][bucket]) ? custom[mode][bucket] : [];

  // 既存 + 追加（重複をある程度抑える）
  const merged = [...base, ...added].filter(Boolean);
  return merged;
}

// =========================
// A版：ネタ選択（0/10/.../100のバケット × 複数ネタ）
// 👍が多いほど出やすい + 直前回避
// =========================
const lastSeedByBucket = {};

function pickSeedByBucket(bucket) {
  bucket = Number(bucket);
  const mode = getSelectedMode(); // "trivia" or "fun"

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

  const key = mode + ":" + String(bucket);
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

  if (!countEl || !badgeEl || !btnEl) return;

  if (!phrase) {
    countEl.textContent = "0";
    badgeEl.textContent = "";
    btnEl.disabled = true;
    btnEl.onclick = null;
    return;
  }

  const count = getLikesFor(phrase);
  countEl.textContent = String(count);
  badgeEl.textContent = count >= 5 ? "⭐人気！" : "";

  btnEl.disabled = false;
  btnEl.onclick = () => {
    incrementLike(phrase);
    updateLikeUI(slot);
  };
}

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

function render() {
  const hintEl = document.getElementById("popHint");
  const sourceTag = document.getElementById("sourceTag");
  const tzTag = document.getElementById("tzTag");
  const metaAll = document.getElementById("metaphor");
  const footEl = document.getElementById("metaFoot");

  if (!hintEl || !sourceTag || !tzTag || !metaAll || !footEl) return;

  sourceTag.textContent = state.source;
  tzTag.textContent = state.tz ? `TZ: ${state.tz}` : "TZ: --";

  const setSlot = (idPop, idMeta, value, label, slotKey) => {
    const popEl = document.getElementById(idPop);
    const metaEl = document.getElementById(idMeta);
    if (!popEl || !metaEl) return null;

    if (value == null) {
      popEl.textContent = "--%";
      metaEl.textContent = "データなし";
      state.currentPhrases[slotKey] = null;
      updateLikeUI(slotKey);
      return null;
    }

    // ※ここは既に「晴れ/曇り/雨のマーク」対応を入れている前提でOK
    // もしここに絵文字を入れるなら：popEl.textContent = `${icon} ${value}%`;
    popEl.textContent = `${value}%`;

    const text = metaphorForPop(value);
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

  footEl.textContent = "※降水確率を0/10/…/100%に丸め、候補からランダム表示（👍が多いほど出やすい）";
}

function renderEmpty() {
  const metaAll = document.getElementById("metaphor");
  if (!metaAll) return;

  const ids = ["m","d","e"];
  ids.forEach(k=>{
    const p = document.getElementById(`pop_${k}`);
    const m = document.getElementById(`meta_${k}`);
    if (p) p.textContent = "--%";
    if (m) m.textContent = "データなし";
    state.currentPhrases[k] = null;
    updateLikeUI(k);
  });

  metaAll.textContent = "地点を選んでください";
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
    pops: { m: maxOrNull(bucket.m), d: maxOrNull(bucket.d), e: maxOrNull(bucket.e) },
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

// モード変更 → render（表示更新）
document.querySelectorAll('input[name="mode"]').forEach(r =>
  r.addEventListener("change", render)
);

// 「同じ確率でも例えを変える」
document.getElementById("refresh").onclick = () => render();

// =========================
// 追加ネタ：管理UI（一覧更新/削除）
// =========================
function renderManageList() {
  const modeEl = document.getElementById("manageMode");
  const bucketEl = document.getElementById("manageBucket");
  const listEl = document.getElementById("manageList");
  const statusEl = document.getElementById("manageStatus");
  if (!modeEl || !bucketEl || !listEl || !statusEl) return;

  const mode = modeEl.value;           // trivia / fun
  const bucket = Number(bucketEl.value);

  const data = loadCustom();
  const arr = (data[mode] && data[mode][bucket]) ? data[mode][bucket] : [];

  statusEl.textContent = `追加ネタ：${arr.length}件（${mode === "trivia" ? "雑学" : "お笑い"} / ${bucket}%）`;

  if (!arr.length) {
    listEl.innerHTML = `<div class="muted">この条件の追加ネタはありません</div>`;
    return;
  }

  listEl.innerHTML = arr.map((t, i) => {
    const safe = String(t).replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `
      <div style="display:flex; gap:8px; align-items:flex-start; margin:6px 0;">
        <button data-del="${i}" style="white-space:nowrap;">削除</button>
        <div style="flex:1;">${safe}</div>
      </div>
    `;
  }).join("");

  listEl.querySelectorAll("button[data-del]").forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.getAttribute("data-del"));
      const d2 = loadCustom();
      const a2 = (d2[mode] && d2[mode][bucket]) ? d2[mode][bucket] : [];
      if (idx >= 0 && idx < a2.length) {
        a2.splice(idx, 1);
        d2[mode][bucket] = a2;
        saveCustom(d2);
        renderManageList();
      }
    };
  });
}

function clearManageBucket() {
  const modeEl = document.getElementById("manageMode");
  const bucketEl = document.getElementById("manageBucket");
  const statusEl = document.getElementById("manageStatus");
  if (!modeEl || !bucketEl || !statusEl) return;

  const mode = modeEl.value;
  const bucket = Number(bucketEl.value);

  const data = loadCustom();
  data[mode][bucket] = [];
  saveCustom(data);

  statusEl.textContent = `削除しました（${mode === "trivia" ? "雑学" : "お笑い"} / ${bucket}%）`;
  renderManageList();
}

function clearManageAll() {
  localStorage.removeItem(CUSTOM_KEY);
  const statusEl = document.getElementById("manageStatus");
  if (statusEl) statusEl.textContent = "全削除しました";
  renderManageList();
}

// 管理UIイベント配線（←ここが「無反応」の原因だった場所）
(function bindManageUI(){
  const btnRefresh = document.getElementById("manageRefresh");
  const btnClearBucket = document.getElementById("manageClearBucket");
  const btnClearAll = document.getElementById("manageClearAll");
  const modeEl = document.getElementById("manageMode");
  const bucketEl = document.getElementById("manageBucket");

  if (btnRefresh) btnRefresh.onclick = renderManageList;
  if (btnClearBucket) btnClearBucket.onclick = clearManageBucket;
  if (btnClearAll) btnClearAll.onclick = clearManageAll;
  if (modeEl) modeEl.onchange = renderManageList;
  if (bucketEl) bucketEl.onchange = renderManageList;

  renderManageList();
})();

// =========================
// ネタ追加（この端末に保存）
// =========================
document.getElementById("addPhraseBtn").onclick = () => {
  const modeEl = document.getElementById("newPhraseMode");
  const bucketEl = document.getElementById("newPhraseBucket");
  const textEl = document.getElementById("newPhrase");
  const statusEl = document.getElementById("addStatus");

  if (!modeEl || !bucketEl || !textEl || !statusEl) return;

  const mode = modeEl.value; // trivia / fun
  const bucket = Number(bucketEl.value);
  const text = (textEl.value || "").trim();

  if (!text) {
    statusEl.textContent = "文章が空です。入力してください。";
    return;
  }

  const data = loadCustom();
  data[mode][bucket] = data[mode][bucket] || [];
  data[mode][bucket].push(text);
  saveCustom(data);

  statusEl.textContent = `追加しました（${mode === "trivia" ? "雑学" : "お笑い"} / ${bucket}%）`;

  // 管理UI側の条件が一致していれば即反映
  const mMode = document.getElementById("manageMode");
  const mBucket = document.getElementById("manageBucket");
  if (mMode && mBucket) {
    mMode.value = mode;
    mBucket.value = String(bucket);
  }
  renderManageList();

  // 入力欄クリア
  textEl.value = "";

  // 表示にも反映（次の render から追加ネタが混ざる）
  render();
};

render();

// END
