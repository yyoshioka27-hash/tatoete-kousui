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

// ==============================
// 追加ネタ管理（localStorage）
// 既存機能は触らず、管理UIだけ増やす
// ==============================
const EXTRA_LS_KEY = "extra_phrases_v1";

// 旧キーが存在する場合の吸収（念のため）
const LEGACY_KEYS = [
  "extra_phrases",
  "extraPhrases",
  "extra_phrases_v0",
  "extra_phrases_bucket",
  "extra_phrases_store"
];

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeParseJSON(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function migrateLegacyIfNeeded() {
  const cur = localStorage.getItem(EXTRA_LS_KEY);
  if (cur) return;

  for (const k of LEGACY_KEYS) {
    const raw = localStorage.getItem(k);
    if (!raw) continue;

    const data = safeParseJSON(raw);
    if (!data) continue;

    // 想定：配列 or 何かしら
    // 配列ならそのまま、オブジェクトなら可能な範囲で拾う
    let list = [];
    if (Array.isArray(data)) {
      list = data;
    } else if (typeof data === "object") {
      // 例： { "trivia_10": ["..."], "fun_20": ["..."] } みたいな形を拾う
      for (const key of Object.keys(data)) {
        const v = data[key];
        if (!Array.isArray(v)) continue;
        const m = key.match(/(trivia|fun)[_\-]?(\d{1,3})/);
        if (!m) continue;
        const mode = m[1];
        const bucket = Number(m[2]);
        v.forEach((t) => {
          const text = String(t || "").trim();
          if (!text) return;
          list.push({
            id: genId(),
            mode,
            bucket,
            text,
            createdAt: Date.now()
          });
        });
      }
    }

    // 正規化して保存
    list = normalizeExtraList(list);
    localStorage.setItem(EXTRA_LS_KEY, JSON.stringify(list));
    return;
  }
}

function genId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function loadExtraStore() {
  migrateLegacyIfNeeded();
  const raw = localStorage.getItem(EXTRA_LS_KEY);
  if (!raw) return [];
  const data = safeParseJSON(raw);
  return Array.isArray(data) ? normalizeExtraList(data) : [];
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
    const bucket = Math.max(0, Math.min(100, Number(item.bucket)));
    const b = window.bucket10(bucket);
    const text = String(item.text || "").trim();

    if (!text) continue;

    // 重複は text+mode+bucket で排除（IDが違っても同じ内容なら1つに）
    const key = `${mode}__${b}__${text}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      id: String(item.id || genId()),
      mode,
      bucket: b,
      text,
      createdAt: Number(item.createdAt || Date.now())
    });
  }

  // 新しい順（表示がわかりやすい）
  out.sort((a, b2) => (b2.createdAt - a.createdAt));
  return out;
}

function getExtraPhrases(mode, bucket) {
  const store = loadExtraStore();
  const m = mode === "fun" ? "fun" : "trivia";
  const b = window.bucket10(bucket);
  return store.filter(x => x.mode === m && x.bucket === b).map(x => x.text);
}

// 管理UIは「ネタ追加」側の選択（newPhraseMode/newPhraseBucket）を参照する
function getManageMode() {
  const el = $("newPhraseMode");
  return el ? el.value : "trivia";
}
function getManageBucket() {
  const el = $("newPhraseBucket");
  return el ? Number(el.value) : 0;
}

// 一覧描画
function renderManageList() {
  const statusEl = $("manageStatus");
  const listEl = $("manageList");
  if (!statusEl || !listEl) return;

  const mode = getManageMode();
  const bucket = window.bucket10(getManageBucket());

  const store = loadExtraStore();
  const filtered = store.filter(x => x.mode === mode && x.bucket === bucket);

  statusEl.textContent = `モード：${mode === "trivia" ? "雑学" : "お笑い"} / 確率：${bucket}%　｜　登録数：${filtered.length}`;

  if (!filtered.length) {
    listEl.innerHTML = `<div class="muted">この条件の追加ネタはまだありません。</div>`;
    return;
  }

  // 1件ずつ削除ボタン付き
  listEl.innerHTML = filtered.map(x => {
    const t = escapeHtml(x.text);
    return `
      <div style="display:flex; gap:10px; align-items:flex-start; border:1px solid #eee; border-radius:12px; padding:10px; margin:8px 0;">
        <div style="flex:1; line-height:1.6; font-size:14px; color:#222;">${t}</div>
        <button data-del-id="${escapeHtml(x.id)}" style="white-space:nowrap;">削除</button>
      </div>
    `;
  }).join("");

  // 削除イベント
  listEl.querySelectorAll("button[data-del-id]").forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute("data-del-id");
      if (!id) return;
      let st = loadExtraStore();
      st = st.filter(x => x.id !== id);
      saveExtraStore(st);
      renderManageList();
      render(); // 表示にも反映
    };
  });
}

function addExtraPhrase(mode, bucket, text) {
  const m = mode === "fun" ? "fun" : "trivia";
  const b = window.bucket10(bucket);
  const t = String(text || "").trim();

  if (!t) return { ok: false, message: "ネタが空です" };
  if (t.length > 200) return { ok: false, message: "長すぎます（200文字以内推奨）" };

  let store = loadExtraStore();
  store.unshift({
    id: genId(),
    mode: m,
    bucket: b,
    text: t,
    createdAt: Date.now()
  });
  store = saveExtraStore(store);

  return { ok: true, message: `追加しました（${m === "trivia" ? "雑学" : "お笑い"} / ${b}%）`, store };
}

function clearExtraBucket(mode, bucket) {
  const m = mode === "fun" ? "fun" : "trivia";
  const b = window.bucket10(bucket);

  let store = loadExtraStore();
  const before = store.length;
  store = store.filter(x => !(x.mode === m && x.bucket === b));
  store = saveExtraStore(store);
  return { removed: before - store.length };
}

function clearExtraAll() {
  localStorage.removeItem(EXTRA_LS_KEY);
  return { removedAll: true };
}

// =========================
// A版：ネタ選択（0/10/.../100のバケット）
// 👍が多いほど出やすい + 直前回避
// + 追加ネタも混ぜる
// =========================
const lastSeedByBucket = {};

function getBasePoolByModeAndBucket(mode, bucket) {
  bucket = Number(bucket);

  const base = (mode === "trivia"
    ? (window.NETA_TRIVIA?.[bucket] ?? [])
    : (window.NETA?.[bucket] ?? []));

  // 追加ネタ
  const extra = getExtraPhrases(mode, bucket);

  // 重複排除して結合
  const seen = new Set();
  const merged = [];
  for (const t of [...base, ...extra]) {
    const s = String(t || "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    merged.push(s);
  }
  return merged;
}

function pickSeedByBucket(bucket) {
  bucket = Number(bucket);

  const mode = getSelectedMode();
  const pool = getBasePoolByModeAndBucket(mode, bucket);

  if (!pool.length) return "データなし";

  // 👍重み：like+1
  const weights = pool.map(t => (likesData[t] || 0) + 1);
  const total = weights.reduce((a, b) => a + b, 0);

  let r = Math.random() * total;
  let picked = pool[0];
  for (let i = 0; i < pool.length; i++) {
    if (r < weights[i]) { picked = pool[i]; break; }
    r -= weights[i];
  }

  // 直前回避（同じbucketで連続を避ける）
  const key = `${mode}_${String(bucket)}`;
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

  const setSlot = (idPop, idMeta, value, label, slotKey) => {
    const popEl = document.getElementById(idPop);
    const metaEl = document.getElementById(idMeta);

    if (value == null) {
      if (popEl) popEl.textContent = "--%";
      if (metaEl) metaEl.textContent = "データなし";
      state.currentPhrases[slotKey] = null;
      updateLikeUI(slotKey);
      return null;
    }

    const rounded = bucket10(value); // 0,10,20,...に丸める
    if (popEl) popEl.textContent = `${rounded}%`;

    const text = metaphorForPop(rounded);
    if (metaEl) metaEl.textContent = `${label}：${text}`;

    state.currentPhrases[slotKey] = text;
    updateLikeUI(slotKey);

    return { value: rounded, text, label };
  };

  if (!state.pops) {
    if (hintEl) hintEl.textContent = "地点を選ぶと自動取得します";
    renderEmpty();
    if (footEl) footEl.textContent = "";
    return;
  }

  if (hintEl) hintEl.textContent = state.placeLabel ? `地点：${state.placeLabel}` : "地点：--";

  const a = setSlot("pop_m", "meta_m", state.pops.m, "朝", "m");
  const b = setSlot("pop_d", "meta_d", state.pops.d, "昼", "d");
  const c = setSlot("pop_e", "meta_e", state.pops.e, "夜", "e");

  const candidates = [a, b, c].filter(Boolean);
  if (!candidates.length) {
    if (metaAll) metaAll.textContent = "データが取得できませんでした（別地点で試してください）";
  } else {
    const maxOne = candidates.reduce((x, y) => (y.value > x.value ? y : x));
    if (metaAll) metaAll.textContent = `今日いちばん怪しいのは【${maxOne.label}】：${maxOne.value}% → ${maxOne.text}`;
  }

  if (footEl) footEl.textContent = "※降水確率を0/10/…/100%に丸め、候補からランダム表示（👍が多いほど出やすい）";
}

function renderEmpty() {
  const metaAll = document.getElementById("metaphor");
  const ids = ["m", "d", "e"];

  ids.forEach(k => {
    const popEl = document.getElementById(`pop_${k}`);
    const metaEl = document.getElementById(`meta_${k}`);
    if (popEl) popEl.textContent = "--%";
    if (metaEl) metaEl.textContent = "データなし";
    state.currentPhrases[k] = null;
    updateLikeUI(k);
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

// モード変更は render を呼ぶだけ（表示を更新）
document.querySelectorAll('input[name="mode"]').forEach(r =>
  r.addEventListener("change", render)
);

// 「同じ確率でも例えを変える」ボタン
document.getElementById("refresh").onclick = () => render();

// =========================
// 追加ネタ：追加・管理ボタン
// =========================
(function wireExtraUI(){
  const addBtn = $("addPhraseBtn");
  const statusEl = $("addStatus");

  const refreshBtn = $("manageRefresh");
  const clearBucketBtn = $("manageClearBucket");
  const clearAllBtn = $("manageClearAll");

  // 初期表示
  renderManageList();

  // セレクト変更で一覧も更新したい（モード/確率を変えたら管理一覧も変える）
  const modeSel = $("newPhraseMode");
  const bucketSel = $("newPhraseBucket");
  if (modeSel) modeSel.addEventListener("change", () => renderManageList());
  if (bucketSel) bucketSel.addEventListener("change", () => renderManageList());

  if (addBtn) {
    addBtn.onclick = () => {
      const mode = getManageMode();
      const bucket = getManageBucket();
      const text = ($("newPhrase")?.value ?? "").trim();

      const res = addExtraPhrase(mode, bucket, text);
      if (statusEl) {
        statusEl.textContent = res.ok ? `✅ ${res.message}` : `⚠️ ${res.message}`;
      }
      if (res.ok) {
        if ($("newPhrase")) $("newPhrase").value = "";
        renderManageList();
        render(); // 表示に反映
      }
    };
  }

  if (refreshBtn) {
    refreshBtn.onclick = () => {
      renderManageList();
      render(); // 念のため
      if (statusEl) statusEl.textContent = "一覧を更新しました";
    };
  }

  if (clearBucketBtn) {
    clearBucketBtn.onclick = () => {
      const mode = getManageMode();
      const bucket = getManageBucket();
      const b = window.bucket10(bucket);
      const label = `${mode === "trivia" ? "雑学" : "お笑い"} / ${b}%`;

      if (!confirm(`${label} の追加ネタを全部削除します。よろしいですか？`)) return;

      const out = clearExtraBucket(mode, bucket);
      if (statusEl) statusEl.textContent = `✅ ${label} を ${out.removed} 件削除しました`;
      renderManageList();
      render();
    };
  }

  if (clearAllBtn) {
    clearAllBtn.onclick = () => {
      if (!confirm("追加ネタを全削除します。よろしいですか？")) return;
      clearExtraAll();
      if (statusEl) statusEl.textContent = "✅ 追加ネタを全削除しました";
      renderManageList();
      render();
    };
  }
})();

// =========================
// Service Worker登録（PWA）
// （今はトラブル回避のためOFFのままでOK）
// =========================
// if ("serviceWorker" in navigator) {
//   navigator.serviceWorker.register("./sw.js", { scope: "./" });
// }

render();

// END
