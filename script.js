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
    try { render(); } catch {}
  });
}

// ==============================
// 承認待ち投稿（Workers）
// ==============================
async function submitToPending(mode, bucket, text, penName){
  const res = await fetch(`${API_BASE}/api/submit`, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ mode, bucket, text, penName, from: "mobile" })
  });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `submit failed ${res.status}`);
  return data;
}

// ==============================
// publicネタ取得（Workers）
// 返り値：[{id, text, penName}, ...]
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

  const items = Array.isArray(data.items) ? data.items : [];
  return items
    .map(it => ({
      id: String(it.id || "").trim(),
      text: String(it.text || "").trim(),
      penName: (it.penName ? String(it.penName).trim() : null)
    }))
    .filter(x => x.id && x.text);
}

// ==============================
// 👍 いいね（Workers）
// - public/base/json すべて対象
// ==============================
async function likeAny(payload){
  // payload: { id, mode, bucket, text, penName, source }
  const res = await fetch(`${API_BASE}/api/like`, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `like failed ${res.status}`);
  return data; // {ok:true, id, likesToday}
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
// 共有ネタ（GitHub PagesのJSON / metaphors.json）
// ==============================
const SHARED_JSON_URL = "./metaphors.json";
let sharedItems = []; // [{mode,bucket,text}, ...]

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

  return base.filter(x => x.mode === m && x.bucket === b);
}

// ==============================
// ✅ publicネタ（Workers /api/public）
// - mode×bucket のキャッシュ
// ==============================
const publicCache = new Map(); // key: "mode_bucket" => [{id,text,penName}, ...]

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
    penName: it.penName || null
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
  currentPhrases: {
    m: { text: null, source: null, id: null, penName: null, likesToday: 0, mode: null, bucket: null },
    d: { text: null, source: null, id: null, penName: null, likesToday: 0, mode: null, bucket: null },
    e: { text: null, source: null, id: null, penName: null, likesToday: 0, mode: null, bucket: null }
  }
};

const $ = (id) => document.getElementById(id);

// =========================
// ✅ 全ネタを一意ID化（base/json も集計対象にする）
// - 速度優先: FNV-1a 32bit
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
// ✅ いいねDOMが無い環境でも自動生成する（HTML改修不要）
// =========================
function ensureLikeDom(slot){
  const btnId = `like_${slot}`;
  if (document.getElementById(btnId)) return;

  const metaEl = document.getElementById(`meta_${slot}`);
  if (!metaEl) return;

  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.alignItems = "center";
  wrap.style.gap = "10px";
  wrap.style.marginTop = "8px";

  const btn = document.createElement("button");
  btn.id = btnId;
  btn.type = "button";
  btn.textContent = "👍 いいね";
  btn.style.padding = "8px 10px";
  btn.style.borderRadius = "12px";
  btn.style.border = "1px solid rgba(15,23,42,.18)";
  btn.style.background = "rgba(255,255,255,.8)";
  btn.style.cursor = "pointer";

  const count = document.createElement("span");
  count.id = `likeCount_${slot}`;
  count.className = "muted";
  count.textContent = "0";

  const badge = document.createElement("span");
  badge.id = `badge_${slot}`;
  badge.className = "muted";
  badge.style.fontWeight = "800";
  badge.textContent = "";
  badge.style.display = "none";

  wrap.appendChild(btn);
  wrap.appendChild(count);
  wrap.appendChild(badge);

  metaEl.insertAdjacentElement("afterend", wrap);
}

// =========================
// ネタ抽選（base + JSON + public を混ぜる）
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
  return base.map(x => String(x || "").trim()).filter(Boolean);
}

// ✅ 公開ネタは全部候補に混ぜる（public/base/json全部）
// - 重複は text で除去（public優先）
function buildCandidatePool(mode, bucket) {
  const b = window.bucket10(bucket);
  const m = (mode === "fun" ? "fun" : "trivia");

  const baseItems = getBaseTexts(m, b).map(text => ({
    text,
    source: "base",
    id: makeGlobalId({ mode: m, bucket: b, text, source: "base" }),
    penName: null
  }));

  const jsonItems = getSharedItems(m, b).map(x => ({
    text: x.text,
    source: "json",
    id: makeGlobalId({ mode: m, bucket: b, text: x.text, source: "json" }),
    penName: null
  }));

  const publicItems = getPublicItems(m, b); // [{text,source:"public",id,penName}]

  const merged = [...publicItems, ...jsonItems, ...baseItems];

  const out = [];
  const seen = new Set();
  for (const item of merged) {
    const t = String(item?.text || "").trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);

    out.push({
      text: t,
      source: item.source || "base",
      id: item.id || makeGlobalId({ mode: m, bucket: b, text: t, source: item.source || "base" }),
      penName: item.penName || null
    });
  }
  return out;
}

function pickMetaphor(mode, bucket) {
  const b = window.bucket10(bucket);
  const pool = buildCandidatePool(mode, b);
  if (!pool.length) return { text: "データなし", source: null, id: null, penName: null };

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
// 👍 UI（公開ネタ＝全部対象）
// - id がある時は表示・押下可能
// - ✅FIX1: いいねはランキングと同じ代表bucketに入れる（反映ズレ防止）
// =========================
function updateLikeUI(slot) {
  ensureLikeDom(slot);

  const phraseObj = state.currentPhrases[slot];
  const btnEl = document.getElementById(`like_${slot}`);
  const countEl = document.getElementById(`likeCount_${slot}`);
  const badgeEl = document.getElementById(`badge_${slot}`);

  if (!btnEl) return;

  const ok = !!phraseObj?.id && !!phraseObj?.text;
  btnEl.style.display = ok ? "" : "none";

  if (!ok) {
    if (countEl) countEl.textContent = "0";
    if (badgeEl) { badgeEl.textContent = ""; badgeEl.style.display = "none"; }
    btnEl.onclick = null;
    return;
  }

  const likesToday = Number(phraseObj.likesToday || 0);
  if (countEl) countEl.textContent = String(likesToday);

  if (badgeEl) {
    badgeEl.textContent = (likesToday >= 5 ? "⭐候補！" : "");
    badgeEl.style.display = (likesToday >= 5 ? "" : "none");
  }

  btnEl.disabled = false;
  btnEl.onclick = async () => {
    btnEl.disabled = true;
    try{
      const mainBucket = getCurrentMainBucket();
      const out = await likeAny({
        id: phraseObj.id,
        mode: phraseObj.mode || getSelectedMode(),
        // ✅FIX: ランキングと同じ代表bucketに格納（ここがズレてると反映されない）
        bucket: Number(mainBucket ?? phraseObj.bucket ?? 0),
        text: phraseObj.text,
        penName: phraseObj.penName || null,
        source: phraseObj.source || null
      });
      state.currentPhrases[slot].likesToday = Number(out.likesToday || 0);
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

      state.currentPhrases[slotKey] = { text: null, source: null, id: null, penName: null, likesToday: 0, mode: null, bucket: null };
      updateLikeUI(slotKey);
      updateDeleteUI(slotKey);
      return null;
    }

    const rounded = window.bucket10(value);
    if (popEl) popEl.textContent = `${rounded}%`;
    setIcon(slotKey, rounded);

    const mode = getSelectedMode();
    const picked = pickMetaphor(mode, rounded);

    const pen = picked.penName ? `（${picked.penName}）` : "";
    if (metaEl) metaEl.textContent = `${label}：${picked.text}${pen}`;

    // ✅FIX2: ネタが変わったら likesToday を引き継がない（モード切替で同数のまま問題を消す）
    const prevId = state.currentPhrases[slotKey]?.id || null;
    const nextId = picked.id || null;
    const nextLikes = (prevId && nextId && prevId === nextId)
      ? Number(state.currentPhrases[slotKey]?.likesToday || 0)
      : 0;

    state.currentPhrases[slotKey] = {
      text: picked.text,
      source: picked.source || null,
      id: nextId,
      penName: picked.penName || null,
      likesToday: nextLikes,
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

    state.currentPhrases[k] = { text: null, source: null, id: null, penName: null, likesToday: 0, mode: null, bucket: null };
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
// ランキング表示（例えを変えるボタンの下）
// =========================
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function renderRanking(){
  const wrap = document.getElementById("todayRankingWrap");
  if (!wrap) return;

  const bucket = getCurrentMainBucket();
  const mode = getSelectedMode();

  if (bucket == null) {
    wrap.innerHTML = "";
    return;
  }

  wrap.innerHTML = `
    <div class="card" style="margin:0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
      <div style="font-weight:900; font-size:16px; margin-bottom:6px;">今日のランキング TOP3（${bucket}% / ${mode==="fun"?"お笑い":"雑学"}）</div>
      <div class="muted" style="margin-bottom:8px;">※今日(JST)のいいね数で集計（公開ネタすべて）</div>
      <div class="muted" id="rankingBody">読み込み中…</div>
    </div>
  `;

  const body = document.getElementById("rankingBody");

  try{
    const items = await fetchRankingToday(mode, bucket, 3);

    if (!items.length) {
      if (body) body.textContent = "まだランキングがありません（今日の👍が0件）";
      return;
    }

    const rows = items.map((it, idx) => {
      const pen = it.penName ? ` <span class="muted">(${escapeHtml(it.penName)})</span>` : "";
      const src = it.source ? ` <span class="muted">[${escapeHtml(it.source)}]</span>` : "";
      return `
        <div style="padding:10px 0; border-top:1px solid rgba(15,23,42,0.10);">
          <div style="font-weight:800;">${idx+1}位：${escapeHtml(it.text)}${pen}${src}</div>
          <div class="muted">今日の👍：${Number(it.likes||0)}</div>
        </div>
      `;
    }).join("");

    // ✅ outerHTML はDOMを壊すので使わない
    if (body) body.innerHTML = rows;

  } catch (e) {
    if (body) body.textContent = `ランキング取得に失敗：${e?.message || e}`;
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
// ✅ ネタ追加（承認待ちへ送信 一本化）
// ==============================
(function setupSubmitPending(){
  const btn = document.getElementById("submitPendingBtn");
  if (!btn) return;

  btn.onclick = async () => {
    const statusEl = document.getElementById("addStatus");

    const mode = ($("newPhraseMode")?.value ?? "trivia");
    const bucketRaw = Number($("newPhraseBucket")?.value ?? 0);
    const bucket = window.bucket10(bucketRaw);
    const text = (document.getElementById("newPhrase")?.value ?? "").trim();
    const penName = (document.getElementById("penName")?.value ?? "").trim();

    if (!text) {
      if (statusEl) statusEl.textContent = "⚠️ ネタが空です";
      return;
    }

    btn.disabled = true;
    try{
      if (statusEl) statusEl.textContent = "📨 承認待ちへ送信中…";
      await submitToPending(mode, bucket, text, penName);

      if (statusEl) statusEl.textContent =
        "✅ 送信しました。承認されると一般公開されます。";

      const ta = document.getElementById("newPhrase");
      if (ta) ta.value = "";
      const pn = document.getElementById("penName");
      if (pn) pn.value = "";
    }catch(e){
      if (statusEl) statusEl.textContent = `⚠️ 送信に失敗：${e?.message || e}`;
    }finally{
      btn.disabled = false;
    }
  };
})();

// ==============================
// 初期化
// ==============================
scheduleRender();
loadSharedJSON().then(() => scheduleRender());

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

// # END
