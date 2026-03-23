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
const BUILD = "2026-03-23_hof_daily_allmode_fastcache__SCRIPT_FULL_v12";

// ✅ API_BASE（/api/health がOKの“正”）
const API_BASE = "https://ancient-union-4aa4tatoete-kousui-api.y-yoshioka27.workers.dev";

// ✅ 殿堂入り日次スナップショット（GitHub Pages側に1日1回だけ配置）
const HOF_DAILY_JSON_URL = `${API_BASE}/api/hof_daily`;
const HOF_DAILY_CACHE_KEY = "hof_daily_cache_v1";
let __hofSnapshotMemory = null;
let __hofSnapshotHtml = null;
let __hofSnapshotPromise = null;

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
  const s = String(text || "");
  return NG_PHRASES.some(w => s.includes(w));
}

// =========================
// ✅ ユーティリティ
// =========================
function escapeHtml(s){
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function bucket10(n){
  const x = Number(n ?? 0);
  return Math.max(0, Math.min(100, Math.round(x / 10) * 10));
}
window.bucket10 = bucket10;

function normalizeMode(m){
  return (String(m || "").trim() === "fun") ? "fun" : "trivia";
}
function modeLabelJa(mode){
  return normalizeMode(mode) === "fun" ? "お笑い" : "雑学";
}
function modeBadgeHtml(mode){
  const m = normalizeMode(mode);
  return `<span class="mode-chip ${m}">${m === "fun" ? "お笑い" : "雑学"}</span>`;
}
function penHtmlIfAny(penName){
  const p = String(penName || "").trim();
  if (!p) return "";
  return ` <span class="muted">(${escapeHtml(p)})</span>`;
}
function num(n){
  const x = Number(n || 0);
  return Number.isFinite(x) ? x : 0;
}

function canonicalText(s){
  return String(s || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/[！!]+/g, "!")
    .replace(/[？?]+/g, "?")
    .trim();
}
function makeGlobalId({ mode, bucket, text, source }){
  return [normalizeMode(mode), bucket10(bucket), canonicalText(text), String(source || "x")].join("::");
}
function uniqueBy(arr, keyFn){
  const m = new Map();
  for (const it of arr || []){
    const k = keyFn(it);
    if (!m.has(k)) m.set(k, it);
  }
  return [...m.values()];
}
function mergeDisplayItems(items){
  return uniqueBy(items || [], (it) => it?.id || makeGlobalId({
    mode: it?.mode,
    bucket: it?.bucket,
    text: it?.text,
    source: it?.source || "merged"
  }));
}

// =========================
// ✅ state
// =========================
const state = {
  mode: "trivia",
  bucket: 0,
  currentWeatherCode: null,
  tz: "Asia/Tokyo",
  nowLabel: "",
  currentPopText: "",
  currentPopMeta: null,
  currentPopSource: "default",
  publicItems: [],
  hallItems: [],
  hofThreshold: 20,
};

// =========================
// ✅ DOM helper
// =========================
const $ = (id) => document.getElementById(id);

// =========================
// ✅ weather icon / label
// =========================
function weatherEmoji(code){
  const c = Number(code);
  if ([0].includes(c)) return "☀️";
  if ([1,2].includes(c)) return "🌤️";
  if ([3].includes(c)) return "☁️";
  if ([45,48].includes(c)) return "🌫️";
  if ([51,53,55,56,57].includes(c)) return "🌦️";
  if ([61,63,65,66,67,80,81,82].includes(c)) return "🌧️";
  if ([71,73,75,77,85,86].includes(c)) return "❄️";
  if ([95,96,99].includes(c)) return "⛈️";
  return "🌈";
}
function weatherLabel(code){
  const c = Number(code);
  if (c === 0) return "快晴";
  if ([1,2].includes(c)) return "晴れ";
  if (c === 3) return "くもり";
  if ([45,48].includes(c)) return "霧";
  if ([51,53,55,56,57].includes(c)) return "霧雨";
  if ([61,63,65,66,67,80,81,82].includes(c)) return "雨";
  if ([71,73,75,77,85,86].includes(c)) return "雪";
  if ([95,96,99].includes(c)) return "雷雨";
  return "天気";
}
function themeClassFromCode(code){
  const c = Number(code);
  if ([95,96,99].includes(c)) return "theme-storm";
  if ([61,63,65,66,67,80,81,82].includes(c)) return "theme-rain";
  if ([71,73,75,77,85,86].includes(c)) return "theme-snow";
  if ([45,48].includes(c)) return "theme-fog";
  if (c === 0) return "theme-sunny";
  if ([1,2,3].includes(c)) return "theme-cloudy";
  return "theme-default";
}
function applyThemeByWeatherCode(code){
  const body = document.body;
  body.classList.remove(
    "theme-storm", "theme-rain", "theme-snow",
    "theme-fog", "theme-sunny", "theme-cloudy", "theme-default"
  );
  body.classList.add(themeClassFromCode(code));
}

// =========================
// ✅ API fetch helper
// =========================
async function fetchJson(url, opt={}){
  const res = await fetch(url, { cache:"no-store", ...opt });
  const data = await res.json().catch(()=>null);
  if (!res.ok) throw new Error(data?.error || `${res.status}`);
  return data;
}

// =========================
// ✅ weather / search
// =========================
async function fetchWeather(){
  const lat = 38.2682;
  const lon = 140.8694;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code&hourly=precipitation_probability` +
    `&timezone=Asia%2FTokyo&forecast_days=1`;

  const r = await fetch(url, { cache:"no-store" });
  const j = await r.json();

  const code = Number(j?.current?.weather_code ?? 0);
  const now = j?.current?.time || null;
  const tz = j?.timezone || "Asia/Tokyo";

  let popNow = 0;
  let hourLabel = "";
  if (Array.isArray(j?.hourly?.time) && Array.isArray(j?.hourly?.precipitation_probability) && now) {
    const idx = j.hourly.time.indexOf(now);
    if (idx >= 0) {
      popNow = Number(j.hourly.precipitation_probability[idx] ?? 0);
      const hh = String(new Date(now).getHours()).padStart(2, "0");
      hourLabel = `${hh}:00`;
    }
  }

  return {
    weatherCode: code,
    weatherEmoji: weatherEmoji(code),
    weatherLabel: weatherLabel(code),
    precipitationProbability: popNow,
    timeLabel: hourLabel,
    tz,
  };
}

// =========================
// ✅ shared json
// =========================
const SHARED_JSON_URL = "./metaphors.json";
let sharedItems = [];
window.JSON_METAPHORS = window.JSON_METAPHORS || [];

async function loadSharedJSON() {
  try {
    const res = await fetch(`${SHARED_JSON_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`shared json http ${res.status}`);

    const json = await res.json();
    const arr = Array.isArray(json) ? json
      : Array.isArray(json?.items) ? json.items
      : [];

    sharedItems = arr
      .map(x => ({
        mode: normalizeMode(x.mode),
        bucket: bucket10(x.bucket ?? 0),
        text: String(x.text || "").trim(),
        penName: x.penName ? String(x.penName).trim() : null,
        source: "shared_json",
        id: makeGlobalId({
          mode: x.mode,
          bucket: x.bucket ?? 0,
          text: x.text || "",
          source: "shared_json"
        })
      }))
      .filter(x => x.text && !isNgText(x.text));

    window.JSON_METAPHORS = sharedItems.slice();
  } catch (e) {
    console.warn("loadSharedJSON failed", e?.message || e);
    sharedItems = [];
    window.JSON_METAPHORS = [];
  }
}

// =========================
// ✅ public / latest
// =========================
async function fetchLatestPublic(mode="trivia", limit=10){
  const m = normalizeMode(mode);
  const url = `${API_BASE}/api/public/latest?mode=${encodeURIComponent(m)}&limit=${encodeURIComponent(limit)}`;
  const data = await fetchJson(url);

  const items = Array.isArray(data?.items) ? data.items : [];
  return items
    .map(raw => ({
      id: raw?.id ? String(raw.id).trim() : makeGlobalId({
        mode: m,
        bucket: Number(raw?.bucket || 0),
        text: raw?.text || "",
        source: "public_latest"
      }),
      mode: normalizeMode(raw?.mode || m),
      bucket: bucket10(raw?.bucket ?? 0),
      text: String(raw?.text || "").trim(),
      penName: raw?.penName ? String(raw.penName).trim() : null,
      likes: Number(raw?.likes || 0),
      totalLikes: Number(raw?.totalLikes || 0),
      source: "public_latest",
      approvedAt: raw?.approvedAt || raw?.createdAt || null
    }))
    .filter(x => x.text && !isNgText(x.text));
}

// =========================
// ✅ ranking today
// =========================
async function fetchTodayRanking(mode="trivia", limit=3){
  const m = normalizeMode(mode);
  const url =
    `${API_BASE}/api/ranking_today?mode=${encodeURIComponent(m)}` +
    `&limit=${encodeURIComponent(limit)}&agg_all_buckets=1`;

  const data = await fetchJson(url);
  const items = Array.isArray(data?.items) ? data.items : [];

  return items
    .map(raw => ({
      id: raw?.id ? String(raw.id).trim() : makeGlobalId({
        mode: m,
        bucket: Number(raw?.bucket || 0),
        text: raw?.text || "",
        source: "ranking_today"
      }),
      mode: normalizeMode(raw?.mode || m),
      bucket: bucket10(raw?.bucket ?? 0),
      text: String(raw?.text || "").trim(),
      penName: raw?.penName ? String(raw.penName).trim() : null,
      likesToday: Number(raw?.likesToday || 0),
      source: "ranking_today"
    }))
    .filter(x => x.text && !isNgText(x.text));
}

// =========================
// ✅ hall of fame
// =========================
async function fetchHallOfFame(mode="trivia", offset=0, limit=20){
  const m = normalizeMode(mode);
  const url =
    `${API_BASE}/api/hof?mode=${encodeURIComponent(m)}&scope=all` +
    `&offset=${encodeURIComponent(offset)}&limit=${encodeURIComponent(limit)}`;

  const data = await fetchJson(url);

  if (data?.hofThreshold != null) {
    state.hofThreshold = Number(data.hofThreshold || state.hofThreshold || 20);
  }

  const items = Array.isArray(data?.items) ? data.items : [];
  return items
    .map(raw => ({
      id: raw?.id ? String(raw.id).trim() : makeGlobalId({
        mode: raw?.mode || m,
        bucket: Number(raw?.bucket || 0),
        text: raw?.text || "",
        source: "hof_api"
      }),
      mode: normalizeMode(raw?.mode || m),
      bucket: bucket10(raw?.bucket ?? 0),
      text: String(raw?.text || "").trim(),
      penName: raw?.penName ? String(raw.penName).trim() : null,
      totalLikes: Number(raw?.totalLikes || 0),
      likes: Number(raw?.likes || 0),
      hof: true,
      source: "hof_api"
    }))
    .filter(x => x.text && !isNgText(x.text));
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

function loadHallDailyCache(){
  try{
    return JSON.parse(localStorage.getItem(HOF_DAILY_CACHE_KEY) || "null");
  }catch{
    return null;
  }
}

function saveHallDailyCache(payload){
  try{
    localStorage.setItem(HOF_DAILY_CACHE_KEY, JSON.stringify({
      ...payload,
      _savedAt: Date.now(),
    }));
  }catch{}
}

async function fetchHallOfFameDaily(limit = 20){
  const today = todayJSTString();
  const cached = loadHallDailyCache();

  if (cached?.day === today && Array.isArray(cached?.items) && cached.items.length > 0) {
    if (cached?.hofThreshold != null) {
      state.hofThreshold = Number(cached.hofThreshold || state.hofThreshold || 20);
    }
    return {
      generatedAt: cached?.generatedAt || null,
      hofThreshold: Number(cached?.hofThreshold || state.hofThreshold || 20),
      items: (cached?.items || [])
        .map(normalizeHallSnapshotItem)
        .filter(Boolean)
        .filter(it => !isNgText(it.text))
        .slice(0, limit)
    };
  }

  const url = `${HOF_DAILY_JSON_URL}?day=${encodeURIComponent(today)}&_=${Date.now()}`;

  try{
    const res = await fetch(url, { method:"GET", cache:"no-store" });
    const data = await res.json().catch(()=>null);

    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `hof_daily failed ${res.status}`);
    }

    const items = (Array.isArray(data?.items) ? data.items : [])
      .map(normalizeHallSnapshotItem)
      .filter(Boolean)
      .filter(it => !isNgText(it.text));

    const hofThreshold = Number(data?.hofThreshold || state.hofThreshold || 20);
    state.hofThreshold = hofThreshold;

    if (!items.length) {
      throw new Error(data?.note || "hof_daily empty");
    }

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
  }catch(e){
    console.warn("hof daily api load failed", e?.message || e);
    throw e;
  }
}

async function fetchHallOfFameForRanking(limit = 20){
  try{
    const daily = await fetchHallOfFameDaily(limit);

    if (Array.isArray(daily?.items) && daily.items.length > 0) {
      return {
        generatedAt: daily?.generatedAt || null,
        hofThreshold: Number(daily?.hofThreshold || state.hofThreshold || 20),
        items: daily.items.slice(0, limit)
      };
    }

    throw new Error("hof_daily empty");
  }catch(e){
    console.warn("hof daily snapshot failed, fallback to api/hof", e?.message || e);

    const [tItems, fItems] = await Promise.all([
      fetchHallOfFame("trivia", 0, limit),
      fetchHallOfFame("fun",    0, limit),
    ]);

    const merged = mergeDisplayItems(
      [...(Array.isArray(tItems) ? tItems : []), ...(Array.isArray(fItems) ? fItems : [])]
        .map(it => ({
          ...it,
          text: String(it?.text || "").trim(),
          penName: it?.penName ? String(it.penName).trim() : null,
          totalLikes: Number(it?.totalLikes || 0),
          bucket: Number.isFinite(Number(it?.bucket)) ? window.bucket10(Number(it.bucket)) : 0,
          mode: (it?.mode === "fun" ? "fun" : (it?.__mode === "fun" ? "fun" : "trivia")),
          source: "public",
          hof: true
        }))
        .filter(it => it.text)
        .filter(it => !isNgText(it.text))
    )
    .sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));

    return {
      generatedAt: null,
      hofThreshold: Number(state.hofThreshold || 20),
      items: merged.slice(0, limit)
    };
  }
}

function buildHallCardHtmlFromSnapshot(hofData){
  const hofItems = Array.isArray(hofData?.items) ? hofData.items : [];
  const hofTh = Number(hofData?.hofThreshold || state.hofThreshold || 20);
  const generatedAt = hofData?.generatedAt ? String(hofData.generatedAt) : null;

  if (!hofItems.length) {
    return `
      <div id="rankHofCard" class="card" style="margin:0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
        <div style="font-weight:900; font-size:16px; margin-bottom:6px;">殿堂入り（全モード共通 / 累計👍${hofTh}以上）</div>
        <div class="muted" style="margin-bottom:8px;">※殿堂入りは1日1回集計</div>
        <div class="muted">まだ殿堂入りがありません（累計👍${hofTh}以上が0件、または本日JSON未生成）</div>
      </div>
    `;
  }

  const rows = hofItems.slice(0, 20).map((it, idx) => {
    const pen = penHtmlIfAny(it.penName);
    const totalLikes = Number(it.totalLikes || 0);
    const md = (it.mode === "fun") ? "fun" : "trivia";
    return `
      <div style="padding:10px 0; border-top:1px solid rgba(15,23,42,0.10);">
        <div style="font-weight:800;">
          ${idx+1}. ${escapeHtml(it.text)}${pen}${modeBadgeHtml(md)}
          <span class="hof-badge">👑殿堂入り</span>
        </div>
        <div class="muted">累計👍：${totalLikes}</div>
      </div>
    `;
  }).join("");

  const snapshotNote = generatedAt
    ? `<div class="muted" style="margin-bottom:8px;">※殿堂入りは1日1回集計 / 生成: ${escapeHtml(generatedAt)}</div>`
    : `<div class="muted" style="margin-bottom:8px;">※殿堂入りは1日1回集計</div>`;

  return `
    <div id="rankHofCard" class="card" style="margin:0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
      <div style="font-weight:900; font-size:16px; margin-bottom:6px;">殿堂入り（全モード共通 / 累計👍${hofTh}以上）</div>
      ${snapshotNote}
      <div>${rows}</div>
    </div>
  `;
}

async function ensureHallSnapshotLoaded(){
  if (__hofSnapshotMemory && Array.isArray(__hofSnapshotMemory.items)) {
    return __hofSnapshotMemory;
  }
  if (__hofSnapshotPromise) {
    return __hofSnapshotPromise;
  }

  __hofSnapshotPromise = fetchHallOfFameForRanking(20)
    .then((hofData) => {
      __hofSnapshotMemory = hofData;
      __hofSnapshotHtml = buildHallCardHtmlFromSnapshot(hofData);
      return hofData;
    })
    .finally(() => {
      __hofSnapshotPromise = null;
    });

  return __hofSnapshotPromise;
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
    const arr = Array.isArray(json) ? json
      : Array.isArray(json?.items) ? json.items
      : [];

    sharedItems = arr
      .map(x => ({
        mode: normalizeMode(x.mode),
        bucket: bucket10(x.bucket ?? 0),
        text: String(x.text || "").trim(),
        penName: x.penName ? String(x.penName).trim() : null,
        source: "shared_json",
        id: makeGlobalId({
          mode: x.mode,
          bucket: x.bucket ?? 0,
          text: x.text || "",
          source: "shared_json"
        })
      }))
      .filter(x => x.text && !isNgText(x.text));

    window.JSON_METAPHORS = sharedItems.slice();
  } catch (e) {
    console.warn("loadSharedJSON failed", e?.message || e);
    sharedItems = [];
    window.JSON_METAPHORS = [];
  }
}

// ==============================
// 公開ネタ（API）
// ==============================
async function fetchPublic(mode, bucket){
  const m = normalizeMode(mode);
  const b = bucket10(bucket);
  const url = `${API_BASE}/api/public?mode=${encodeURIComponent(m)}&bucket=${encodeURIComponent(b)}&limit=300`;

  try{
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json().catch(()=>null);
    if (!res.ok || !data?.ok) throw new Error(`public http ${res.status}`);

    return (Array.isArray(data.items) ? data.items : [])
      .map(raw => ({
        id: raw?.id ? String(raw.id).trim() : makeGlobalId({
          mode: m,
          bucket: b,
          text: raw?.text || "",
          source: "public"
        }),
        mode: normalizeMode(raw?.mode || m),
        bucket: bucket10(raw?.bucket ?? b),
        text: String(raw?.text || "").trim(),
        penName: raw?.penName ? String(raw.penName).trim() : null,
        likes: num(raw?.likes),
        totalLikes: num(raw?.totalLikes),
        source: "public",
        hof: !!raw?.hof,
      }))
      .filter(x => x.text && !isNgText(x.text));
  }catch(e){
    console.warn("fetchPublic failed", e?.message || e);
    return [];
  }
}

// ==============================
// いいね
// ==============================
async function likeItem(item){
  if (!item?.id) return;
  const cid = getClientId();

  const res = await fetch(`${API_BASE}/api/like`, {
    method: "POST",
    cache: "no-store",

      .filter(x => x.id && x.text)
      .filter(x => !isNgText(x.text));
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

function loadHallDailyCache(){
  try{
    return JSON.parse(localStorage.getItem(HOF_DAILY_CACHE_KEY) || "null");
  }catch{
    return null;
  }
}

function saveHallDailyCache(payload){
  try{
    localStorage.setItem(HOF_DAILY_CACHE_KEY, JSON.stringify({
      ...payload,
      _savedAt: Date.now(),
    }));
  }catch{}
}

async function fetchHallOfFameDaily(limit = 20){
  const today = todayJSTString();
  const cached = loadHallDailyCache();

  if (cached?.day === today && Array.isArray(cached?.items) && cached.items.length > 0) {
    if (cached?.hofThreshold != null) {
      state.hofThreshold = Number(cached.hofThreshold || state.hofThreshold || 20);
    }
    return {
      generatedAt: cached?.generatedAt || null,
      hofThreshold: Number(cached?.hofThreshold || state.hofThreshold || 20),
      items: (cached?.items || [])
        .map(normalizeHallSnapshotItem)
        .filter(Boolean)
        .filter(it => !isNgText(it.text))
        .slice(0, limit)
    };
  }

  const url = `${HOF_DAILY_JSON_URL}?day=${encodeURIComponent(today)}&_=${Date.now()}`;

  try{
    const res = await fetch(url, { method:"GET", cache:"no-store" });
    const data = await res.json().catch(()=>null);

    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `hof_daily failed ${res.status}`);
    }

    const items = (Array.isArray(data?.items) ? data.items : [])
      .map(normalizeHallSnapshotItem)
      .filter(Boolean)
      .filter(it => !isNgText(it.text));

    const hofThreshold = Number(data?.hofThreshold || state.hofThreshold || 20);
    state.hofThreshold = hofThreshold;

    // 空配列は「本日スナップショット未生成」の可能性が高いのでキャッシュしない
    if (!items.length) {
      throw new Error(data?.note || "hof_daily empty");
    }

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
  }catch(e){
    console.warn("hof daily api load failed", e?.message || e);
    throw e;
  }
}

async function fetchHallOfFameForRanking(limit = 20){
  try{
    const daily = await fetchHallOfFameDaily(limit);

    if (Array.isArray(daily?.items) && daily.items.length > 0) {
      return {
        generatedAt: daily?.generatedAt || null,
        hofThreshold: Number(daily?.hofThreshold || state.hofThreshold || 20),
        items: daily.items.slice(0, limit)
      };
    }

    throw new Error("hof_daily empty");
  }catch(e){
    console.warn("hof daily snapshot failed, fallback to api/hof", e?.message || e);

    const [tItems, fItems] = await Promise.all([
      fetchHallOfFame("trivia", 0, limit),
      fetchHallOfFame("fun",    0, limit),
    ]);

    const merged = mergeDisplayItems(
      [...(Array.isArray(tItems) ? tItems : []), ...(Array.isArray(fItems) ? fItems : [])]
        .map(it => ({
          ...it,
          text: String(it?.text || "").trim(),
          penName: it?.penName ? String(it.penName).trim() : null,
          totalLikes: Number(it?.totalLikes || 0),
          bucket: Number.isFinite(Number(it?.bucket)) ? window.bucket10(Number(it.bucket)) : 0,
          mode: (it?.mode === "fun" ? "fun" : (it?.__mode === "fun" ? "fun" : "trivia")),
          source: "public",
          hof: true
        }))
        .filter(it => it.text)
        .filter(it => !isNgText(it.text))
    )
    .sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));

    return {
      generatedAt: null,
      hofThreshold: Number(state.hofThreshold || 20),
      items: merged.slice(0, limit)
    };
  }
}

function buildHallCardHtmlFromSnapshot(hofData){
  const hofItems = Array.isArray(hofData?.items) ? hofData.items : [];
  const hofTh = Number(hofData?.hofThreshold || state.hofThreshold || 20);
  const generatedAt = hofData?.generatedAt ? String(hofData.generatedAt) : null;

  if (!hofItems.length) {
    return `
      <div id="rankHofCard" class="card" style="margin:0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
        <div style="font-weight:900; font-size:16px; margin-bottom:6px;">殿堂入り（全モード共通 / 累計👍${hofTh}以上）</div>
        <div class="muted" style="margin-bottom:8px;">※殿堂入りは1日1回集計</div>
        <div class="muted">まだ殿堂入りがありません（累計👍${hofTh}以上が0件、または本日JSON未生成）</div>
      </div>
    `;
  }

  const rows = hofItems.slice(0, 20).map((it, idx) => {
    const pen = penHtmlIfAny(it.penName);
    const totalLikes = Number(it.totalLikes || 0);
    const md = (it.mode === "fun") ? "fun" : "trivia";
    return `
      <div style="padding:10px 0; border-top:1px solid rgba(15,23,42,0.10);">
        <div style="font-weight:800;">
          ${idx+1}. ${escapeHtml(it.text)}${pen}${modeBadgeHtml(md)}
          <span class="hof-badge">👑殿堂入り</span>
        </div>
        <div class="muted">累計👍：${totalLikes}</div>
      </div>
    `;
  }).join("");

  const snapshotNote = generatedAt
    ? `<div class="muted" style="margin-bottom:8px;">※殿堂入りは1日1回集計 / 生成: ${escapeHtml(generatedAt)}</div>`
    : `<div class="muted" style="margin-bottom:8px;">※殿堂入りは1日1回集計</div>`;

  return `
    <div id="rankHofCard" class="card" style="margin:0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
      <div style="font-weight:900; font-size:16px; margin-bottom:6px;">殿堂入り（全モード共通 / 累計👍${hofTh}以上）</div>
      ${snapshotNote}
      <div>${rows}</div>
    </div>
  `;
}

async function ensureHallSnapshotLoaded(){
  if (__hofSnapshotMemory && Array.isArray(__hofSnapshotMemory.items)) {
    return __hofSnapshotMemory;
  }

  const hofData = await fetchHallOfFameForRanking(20);
  __hofSnapshotMemory = hofData;
  __hofSnapshotHtml = buildHallCardHtmlFromSnapshot(hofData);
  return hofData;
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
        text: String(it.text || "").trim(),
        source: "json"
      }))
      .filter(it => it.text)
      .filter(it => !isNgText(it.text));

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
        text: String(it?.text || "").trim(),
        source: "json"
      })).filter(x => x.text) : []);

  return base
    .filter(x => x.mode === m && x.bucket === b)
    .filter(x => !isNgText(x.text));
}

// ==============================
// ✅ publicネタ（Workers /api/public）キャッシュ
// ==============================
const publicCache = new Map();
const publicInFlight = new Map();

function keyMB(mode, bucket){
  const m = (mode === "fun" ? "fun" : "trivia");
  const b = window.bucket10(bucket);
  return `${m}_${b}`;
}

function uniqueBucketsFromPops(pops){
  try{
    const arr = [pops?.m, pops?.d, pops?.e].map(v => window.bucket10(v ?? 0));
    return Array.from(new Set(arr));
  }catch{
    return [];
  }
}

async function warmPublicCache(mode, bucket){
  const k = keyMB(mode, bucket);

  if (publicCache.has(k)) return publicCache.get(k) || [];

  const inflight = publicInFlight.get(k);
  if (inflight) return inflight;

  const p = (async () => {
    try{
      const items = await fetchPublicMetaphors({
        mode: (mode === "fun" ? "fun" : "trivia"),
        bucket: window.bucket10(bucket),
        limit: 80
      });
      publicCache.set(k, items);
      return items;
    }catch{
      publicCache.set(k, []);
      return [];
    }finally{
      publicInFlight.delete(k);
    }
  })();

  publicInFlight.set(k, p);
  return p;
}

function getPublicItems(mode, bucket){
  const k = keyMB(mode, bucket);
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

// ✅ SWRキャッシュ
const WX_CACHE_KEY = "wx_pops_cache_v1";
const WX_CACHE_TTL_MS = 10 * 60 * 1000;

function wxKey(lat, lon){
  const la = Math.round(Number(lat) * 100) / 100;
  const lo = Math.round(Number(lon) * 100) / 100;
  return `${la},${lo}`;
}
function loadWxCache(){
  try { return JSON.parse(localStorage.getItem(WX_CACHE_KEY) || "{}"); }
  catch { return {}; }
}
function saveWxCache(obj){
  try { localStorage.setItem(WX_CACHE_KEY, JSON.stringify(obj)); } catch {}
}
async function fetchWithTimeout(url, ms = 4500){
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try{
    return await fetch(url, { cache: "no-store", signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

// =========================
// state
// =========================
let state = {
  pops: null,
  placeLabel: null,
  tz: null,
  source: "API: 未接続",
  hofThreshold: 20,
  selectedLat: null,
  selectedLon: null,
  currentPhrases: {
    m: { text: null, source: null, id: null, penName: null, likesToday: 0, totalLikes: 0, hof: false, mode: null, bucket: null, dedupeKey: null },
    d: { text: null, source: null, id: null, penName: null, likesToday: 0, totalLikes: 0, hof: false, mode: null, bucket: null, dedupeKey: null },
    e: { text: null, source: null, id: null, penName: null, likesToday: 0, totalLikes: 0, hof: false, mode: null, bucket: null, dedupeKey: null }
  }
};

// ✅ 全ネタ一意ID（base/jsonも集計対象）
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
  const b = Number.isFinite(Number(bucket)) ? window.bucket10(Number(bucket)) : 0;
  const t = normalizeMetaphorText(text);
  return `t_${m}_${b}_${fnv1a32(`${m}|${b}|${t}`)}`;
}

// アイコン
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

// theme
function applyTheme(rounded){
  try{
    const body = document.body;
    if (!body) return;
    body.classList.remove("theme-sunny", "theme-cloudy", "theme-rainy");
    if (rounded == null) return;

    const p = Number(rounded);
    if (p <= 20) body.classList.add("theme-sunny");
    else if (p <= 60) body.classList.add("theme-cloudy");
    else body.classList.add("theme-rainy");
  }catch(e){
    console.warn("applyTheme error", e);
  }
}

// =========================
// ✅ いいねUI DOM補完
// =========================
function ensureLikeDom(slot){
  const btn = document.getElementById(`like_${slot}`);
  let count = document.getElementById(`likeCount_${slot}`);
  let badge = document.getElementById(`badge_${slot}`);

  if (!btn) return;

  btn.classList.add("like-btn-pop");

  if (!count) {
    const span = document.createElement("span");
    span.id = `likeCount_${slot}`;
    span.textContent = "0";
    span.style.fontWeight = "900";
    span.style.marginLeft = "6px";

    btn.textContent = "👍";
    btn.appendChild(span);
    count = span;
  }

  const totalId = `likeTotal_${slot}`;
  let total = document.getElementById(totalId);
  if (!total) {
    total = document.createElement("span");
    total.id = totalId;
    total.className = "muted";
    total.textContent = "累計👍0";
    total.style.marginLeft = "10px";
    btn.insertAdjacentElement("afterend", total);
  }

  if (!badge) {
    const wrap = btn.parentElement;
    if (wrap) {
      const b = document.createElement("span");
      b.id = `badge_${slot}`;
      b.style.marginLeft = "6px";
      wrap.appendChild(b);
    }
  }
}

function getSelectedMode() {
  const el = document.querySelector('input[name="mode"]:checked');
  const v = (el ? String(el.value || "").trim() : "");
  if (v === "fun" || v === "お笑い") return "fun";
  if (v === "trivia" || v === "雑学") return "trivia";
  return "trivia";
}

function getBaseTexts(mode, bucket) {
  bucket = Number(bucket);
  const base = (mode === "trivia"
    ? (window.NETA_TRIVIA?.[bucket] ?? [])
    : (window.NETA?.[bucket] ?? []));
  return base
    .map(x => String(x || "").trim())
    .filter(Boolean)
    .filter(t => !isNgText(t));
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
    hof: false,
    mode: m,
    bucket: b
  }));

  const jsonItems = getSharedItems(m, b).map(x => ({
    text: x.text,
    source: "json",
    id: makeGlobalId({ mode: m, bucket: b, text: x.text, source: "json" }),
    penName: null,
    totalLikes: 0,
    hof: false,
    mode: m,
    bucket: b
  }));

  const publicItems = getPublicItems(m, b).map(x => ({
    ...x,
    mode: m,
    bucket: b
  }));

  const merged = mergeDisplayItems([...publicItems, ...jsonItems, ...baseItems], { mode: m, bucket: b });

  return merged
    .map(item => ({
      text: String(item?.text || "").trim(),
      source: item.source || "base",
      id: item.id || makeGlobalId({ mode: m, bucket: b, text: item?.text || "", source: item.source || "base" }),
      penName: item.penName || null,
      totalLikes: Number(item.totalLikes || 0),
      hof: !!item.hof,
      bucket: b,
      mode: m,
      dedupeKey: makeMetaphorDedupeKey({ mode: m, bucket: b, text: item?.text || "" })
    }))
    .filter(item => item.text)
    .filter(item => !isNgText(item.text))
    .filter(item => !hasHard100PercentMismatch(item.text, b))
    .filter(item => !hasMismatchedPercent(item.text, b));
}

const lastPickKey = {};

function pickMetaphor(mode, bucket) {
  const b = window.bucket10(bucket);
  const pool = buildCandidatePool(mode, b);

  if (!pool.length) {
    return {
      text: "データなし",
      source: null,
      id: null,
      penName: null,
      totalLikes: 0,
      hof: false,
      bucket: b,
      mode,
      dedupeKey: null
    };
  }

  const key = `${mode}_${b}`;
  const publicPool = pool.filter(x => x.source === "public");
  let picked;

  if (publicPool.length && Math.random() < 0.7) {
    picked = publicPool[Math.floor(Math.random() * publicPool.length)];
  } else {
    picked = pool[Math.floor(Math.random() * pool.length)];
  }

  if (pool.length > 1) {
    let attempts = 0;
    while ((picked.dedupeKey || picked.text) === lastPickKey[key] && attempts < 8) {
      if (publicPool.length && Math.random() < 0.7) {
        picked = publicPool[Math.floor(Math.random() * publicPool.length)];
      } else {
        picked = pool[Math.floor(Math.random() * pool.length)];
      }
      attempts++;
    }
  }

  lastPickKey[key] = picked.dedupeKey || picked.text;
  return picked;
}

function getCurrentMainBucket(){
  if (!state?.pops) return null;
  const arr = [state.pops.m, state.pops.d, state.pops.e].filter(v => v != null);
  if (!arr.length) return null;
  return window.bucket10(Math.max(...arr));
}
// =========================
// ✅ いいねUI（public/base/jsonすべてOK）
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
      const out = await likeAny({
        id: phraseObj.id,
        mode: phraseObj.mode || getSelectedMode(),
        bucket: Number(phraseObj.bucket ?? 0),
        text: phraseObj.text,
        penName: normalizePenName(phraseObj.penName),
        source: phraseObj.source || null,
        clientId: getClientId(),
      });

      likeFxPop(btnEl);
      likeFxPlusOne(btnEl);

      state.currentPhrases[slot].likesToday = Number(out.likesToday || 0);
      state.currentPhrases[slot].totalLikes = Number(out.totalLikes || state.currentPhrases[slot].totalLikes || 0);
      state.currentPhrases[slot].hof = !!out.hof || (state.currentPhrases[slot].totalLikes >= Number(state.hofThreshold || 20));

      updateLikeUI(slot);
    }catch(e){
      alert(`いいね失敗：${e?.message || e}`);
    }finally{
      btnEl.disabled = false;
    }
  };
}

function updateDeleteUI(slotKey) {
  const btn = document.getElementById(`del_${slotKey}`);
  if (!btn) return;
  btn.style.display = "none";
  btn.onclick = null;
}

// =========================
// renderEmpty
// =========================
function renderEmpty() {
  const metaAll = document.getElementById("metaphor");

  ["m","d","e"].forEach(k => {
    const popEl = document.getElementById(`pop_${k}`);
    const metaEl = document.getElementById(`meta_${k}`);

    if (popEl) popEl.textContent = "--%";
    if (metaEl) metaEl.textContent = "データなし";
    setIcon(k, null);

    state.currentPhrases[k] = {
      text: null, source: null, id: null, penName: null,
      likesToday: 0, totalLikes: 0, hof: false, mode: null, bucket: null, dedupeKey: null
    };
    updateLikeUI(k);
    updateDeleteUI(k);
    return;
  }
        if (reqId !== __rankingReqSeq) return;
      const el = document.getElementById("rankLatestCard");
      if (el) el.outerHTML = html;
      try{
        const det = document.getElementById("latestDetails");
        if (det && !det.dataset.wired){
          det.dataset.wired = "1";
          det.addEventListener("toggle", () => {
            saveLatestOpen(!!det.open);
          });
        }
      }catch{}
    });

    todayPromise.then((html) => {
      if (reqId !== __rankingReqSeq) return;
      const el = document.getElementById("rankTodayCard");
      if (el) el.outerHTML = html;
    });

    hofPromise.then((html) => {
      if (reqId !== __rankingReqSeq) return;
      const el = document.getElementById("rankHofCard");
      if (el) el.outerHTML = html;
    });

    await Promise.allSettled([latestPromise, todayPromise, hofPromise]);

  } catch(e){
    console.warn("renderRanking error", e);
  } finally {
    setRankingBusy(false);
  }
}

// =========================
// ✅ 承認フラグがあれば次の検索成功で花火
// =========================
function fireIfApprovedOnNextSearch(){
  try{
    const raw = localStorage.getItem("fw_on_next_search");
    if (!raw) return;

    const obj = JSON.parse(raw || "{}");
    const ts = Number(obj.ts || 0);
    if (!ts) { localStorage.removeItem("fw_on_next_search"); return; }

    const TTL = 24 * 60 * 60 * 1000;
    if (Date.now() - ts > TTL) {
      localStorage.removeItem("fw_on_next_search");
      return;
    }

    localStorage.removeItem("fw_on_next_search");
    fireworksOnce();
  }catch(e){
    console.warn("fireIfApprovedOnNextSearch error", e);
  }
}

// =========================
// UI: 検索→候補表示
// =========================
(function wireSearch(){
  const btn = document.getElementById("search");
  if (!btn) return;

  btn.onclick = async () => {
    const raw = document.getElementById("place").value.trim();
    const q = normalizePlaceName(raw);

    const sel = document.getElementById("candidates");
    sel.innerHTML = "";
    sel.disabled = true;

    if (!q) { setStatus("地点名を入力してください", "ng"); return; }

    setSearchBusy(true);
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
        const mySeq = ++__searchSeq;

        const opt = sel.options[sel.selectedIndex];
        const lat = Number(opt.dataset.lat);
        const lon = Number(opt.dataset.lon);

        state.selectedLat = lat;
        state.selectedLon = lon;
        state.placeLabel = opt.textContent;
        state.source = "API: Open-Meteo";

        invalidateRanking();
        setRankingBusy(true);
        setSearchBusy(true);
        setStatus("天気取得中…", "muted");

        let cachedOut = null;

        try {
          const out = await fetchPopsBySlotsSWR(lat, lon, {
            onCached: (cached) => {
              if (mySeq !== __searchSeq) return;
              if (!cached?.pops) return;
              cachedOut = { pops: cached.pops, tz: cached.tz || null };
            }
          });

          if (mySeq !== __searchSeq) return;

          const nextPops = out.pops;
          const nextTz = out.tz;

          const mode = getSelectedMode();
          const buckets = uniqueBucketsFromPops(nextPops);
          await Promise.all(buckets.map(b => warmPublicCache(mode, b)));

          if (mySeq !== __searchSeq) return;

          state.pops = nextPops;
          state.tz = nextTz;

          const any = (state.pops.m != null) || (state.pops.d != null) || (state.pops.e != null);
          if (!any) {
            setStatus("降水確率が取得できませんでした（別地点で試してください）", "ng");
            state.source = "API: 取得失敗";
            state.pops = null;
            scheduleRender();
            return;
          }

          __freezeMetaphor = false;
          window.__forceRepick = true;
          scheduleRender();
          requestAnimationFrame(() => {
            window.__forceRepick = false;
          });

          setStatus("取得しました", "ok");

          try{ pingUsageOncePerDay("wx_ok"); }catch{}
          try { fireIfApprovedOnNextSearch(); } catch {}

          try{
            const key = getRankingKeyNow();
            await renderRankingOnce(key);
          }catch(e){
            console.warn("renderRankingOnce(after search) failed", e);
          }

        } catch (e) {
          if (mySeq !== __searchSeq) return;

          if (cachedOut?.pops) {
            const mode = getSelectedMode();
            const buckets = uniqueBucketsFromPops(cachedOut.pops);
            await Promise.all(buckets.map(b => warmPublicCache(mode, b))).catch(() => {});

            if (mySeq !== __searchSeq) return;

            state.pops = cachedOut.pops;
            state.tz = cachedOut.tz || null;
            state.source = "API: キャッシュ";

            __freezeMetaphor = false;
            window.__forceRepick = true;
            scheduleRender();
            requestAnimationFrame(() => {
              window.__forceRepick = false;
            });

            setStatus(`最新の取得に失敗（キャッシュ表示）：${e?.message || e}`, "ng");

            try{
              const key = getRankingKeyNow();
              await renderRankingOnce(key);
            }catch(err){
              console.warn("renderRankingOnce(cache fallback) failed", err);
            }
            return;
          }

          setStatus(e.message || "天気取得エラー", "ng");
          state.source = "API: エラー";
          state.pops = null;
          scheduleRender();
        } finally {
          if (mySeq === __searchSeq) {
            setSearchBusy(false);
            setRankingBusy(false);
          }
        }
      };

      sel.selectedIndex = 0;
      await sel.onchange();

    } catch (e) {
      setStatus(e.message || "検索エラー", "ng");
    } finally {
      setSearchBusy(false);
    }
  };
})();

// =========================
// mode 切替（ランキング更新）
// =========================
document.querySelectorAll('input[name="mode"]').forEach(r =>
  r.addEventListener("change", async () => {
    invalidateRanking();

    if (!state?.pops) {
      __freezeMetaphor = false;
      window.__forceRepick = true;
      scheduleRender();
      requestAnimationFrame(() => {
        window.__forceRepick = false;
      });
      return;
    }

    try{
      setRankingBusy(true);

      const mode = getSelectedMode();
      const buckets = uniqueBucketsFromPops(state.pops);
      await Promise.all(buckets.map(b => warmPublicCache(mode, b)));

      __freezeMetaphor = false;
      window.__forceRepick = true;
      scheduleRender();
      requestAnimationFrame(() => {
        window.__forceRepick = false;
      });

      const key = getRankingKeyNow();
      await renderRankingOnce(key);
    }catch(e){
      console.warn("renderRankingOnce(on mode change) failed", e);
    }finally{
      setRankingBusy(false);
    }
  })
);

(function wireRefresh(){
  const btn = document.getElementById("refresh");
  if (!btn) return;

  btn.onclick = () => {
    window.__forceRepick = true;
    __freezeMetaphor = false;

    scheduleRender();
    requestAnimationFrame(() => {
      window.__forceRepick = false;
    });
  };
})();

// ==============================
// ✅ 自分の投稿欄DOM（HTML改修不要）
// ==============================
function ensureMySubmissionsDom(){
  if (document.getElementById("mySubmissionsWrap")) return true;

  const wrap = document.createElement("div");
  wrap.id = "mySubmissionsWrap";
  wrap.className = "card";
  wrap.style.marginTop = "12px";
  wrap.style.maxWidth = "760px";
  wrap.style.marginLeft = "auto";
  wrap.style.marginRight = "auto";

  wrap.innerHTML = `
    <div style="font-weight:900;">あなたの投稿</div>
    <div class="muted" style="margin-top:6px;font-size:12px;">
      この端末から投稿した分だけ表示（他人には見えません）
    </div>
    <div id="my-submissions-list" style="margin-top:10px;"></div>
  `;

  document.body.appendChild(wrap);
  return true;
}

// =========================
// 🎆 Fireworks (no library)
// =========================
let __fwCanvas = null;
let __fwCtx = null;
let __fwRAF = 0;
let __fwActive = false;
let __fwParticles = [];
let __fwStartAt = 0;
let __fwDuration = 5000;

function ensureFireworksCanvas(){
  if (__fwCanvas) return;

  __fwCanvas = document.createElement("canvas");
  __fwCanvas.id = "fireworksCanvas";
  __fwCanvas.style.position = "fixed";
  __fwCanvas.style.left = "0";
  __fwCanvas.style.top = "0";
  __fwCanvas.style.width = "100%";
  __fwCanvas.style.height = "100%";
  __fwCanvas.style.pointerEvents = "none";
  __fwCanvas.style.zIndex = "2147483647";
  __fwCanvas.style.opacity = "0";
  __fwCanvas.style.willChange = "opacity, transform";
  document.body.appendChild(__fwCanvas);

  __fwCtx = __fwCanvas.getContext("2d", { alpha: true });
  if (!__fwCtx) {
    console.warn("fireworks: getContext failed");
    return;
  }

  const resize = () => {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    __fwCanvas.width  = Math.floor(window.innerWidth  * dpr);
    __fwCanvas.height = Math.floor(window.innerHeight * dpr);
    __fwCanvas.style.width = `${window.innerWidth}px`;
    __fwCanvas.style.height = `${window.innerHeight}px`;
    __fwCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize, { passive:true });
}

function rand(min, max){ return Math.random() * (max - min) + min; }

function spawnBurst(x, y){
  const count = Math.floor(rand(50, 95));
  const hueBase = rand(0, 360);
  for (let i = 0; i < count; i++){
    const ang = rand(0, Math.PI * 2);
    const spd = rand(1.5, 5.5);
    __fwParticles.push({
      x, y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - rand(0.2, 1.4),
      r: rand(1.5, 3.8),
      life: rand(40, 75),
      alpha: 1,
      hue: (hueBase + rand(-25, 25) + 360) % 360
    });
  }
}

function fireworksOnce(){
  ensureFireworksCanvas();
  if (!__fwCanvas || !__fwCtx) return;

  const now = performance.now();
  if (__fwActive){
    __fwStartAt = now;
    __fwDuration = 8000;
    __fwCanvas.style.opacity = "1";
    return;
  }

  __fwActive = true;
  __fwStartAt = now;
  __fwDuration = 8000;
  __fwParticles = [];
  __fwCanvas.style.opacity = "1";

  const w = window.innerWidth;
  const h = window.innerHeight;

  spawnBurst(rand(w*0.2, w*0.8), rand(h*0.2, h*0.45));
  spawnBurst(rand(w*0.2, w*0.8), rand(h*0.2, h*0.45));

  const tick = () => {
    __fwRAF = requestAnimationFrame(tick);

    const t = performance.now();
    const elapsed = t - __fwStartAt;

    if (Math.random() < 0.16 && elapsed < __fwDuration){
      spawnBurst(rand(w*0.15, w*0.85), rand(h*0.18, h*0.5));
    }

    __fwCtx.globalCompositeOperation = "source-over";
    __fwCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    for (let i=__fwParticles.length-1; i>=0; i--){
      const p = __fwParticles[i];
      p.x += p.vx;
      p.y += p.vy;

      p.vx *= 0.98;
      p.vy = p.vy * 0.98 + 0.06;

      p.life -= 1;
      p.alpha *= 0.985;

      __fwCtx.beginPath();
      __fwCtx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      __fwCtx.fillStyle = `hsla(${p.hue}, 100%, 55%, ${Math.max(0, p.alpha)})`;
      __fwCtx.fill();

      if (p.life <= 0 || p.alpha <= 0.02){
        __fwParticles.splice(i, 1);
      }
    }

    if (elapsed > __fwDuration && __fwParticles.length === 0){
      stopFireworks();
    }
  };

  tick();
}

function stopFireworks(){
  if (!__fwActive) return;
  __fwActive = false;
  cancelAnimationFrame(__fwRAF);
  __fwRAF = 0;
  __fwParticles = [];
  if (__fwCtx) __fwCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  if (__fwCanvas) __fwCanvas.style.opacity = "0";
}

// ==============================
// ✅ ネタ追加（承認待ちへ送信）
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
      const clientId = makeGlobalId({ mode, bucket: window.bucket10(bucket), text, source: "local" });

      const out = await submitToPending(
        mode,
        window.bucket10(bucket),
        text,
        (penName || null),
        (penName ? penPin : null),
        clientId
      );

      const serverId = String(out?.id || "").trim();
      if (!serverId) {
        alert("送信は成功しましたが、サーバIDが取得できませんでした。");
        ta.value = "";
        return;
      }

      const my = {
        id: serverId,
        serverId: serverId,
        clientId: clientId,
        text: text,
        status: "pending",
        createdAt: Date.now(),
        mode: mode,
        bucket: window.bucket10(bucket)
      };

      saveMySubmission(my);

      ta.value = "";
      try{ ensureMySubmissionsDom(); }catch{}
      try{ renderMySubmissions(); }catch{}
      try{ await syncMySubmissionsStatus(); }catch{}

      alert("送信しました！（承認待ちに入りました）");
    }catch(e){
      alert(`送信失敗：${e?.message || e}`);
    }finally{
      btn.disabled = false;
      btn.textContent = oldText;
    }
  });
}

// ==============================
// ✅ 自分の投稿：承認状態同期
// ==============================
async function syncMySubmissionsStatus(){
  try{
    const key = "my_submissions";
    const list = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(list) || list.length === 0) return;

    const ids = Array.from(new Set(
      list.flatMap(x => {
        const a = String(x?.serverId || x?.id || "").trim();
        const b = String(x?.clientId || "").trim();
        return [a, b].filter(v => v && !v.startsWith("local_"));
      })
    )).slice(0, 50);

    if (ids.length === 0) return;

    const res = await fetch(`${API_BASE}/api/status?ids=${encodeURIComponent(ids.join(","))}`, { method:"GET", cache:"no-store" });
    const data = await res.json().catch(()=>null);

    if (!res.ok || !data?.ok) {
      console.warn("syncMySubmissionsStatus: bad response", res.status, data);
      return;
    }

    const items = Array.isArray(data?.items) ? data.items : [];
    const map = new Map(items.map(x => [String(x.id), x]));

    let becameApproved = 0;

    const next = list.map(x => {
      const serverId = String(x?.serverId || "").trim();
      const clientId = String(x?.clientId || "").trim();
      const id = String(x?.id || "").trim();

      const prev = String(x?.status || "pending");
      const st = map.get(serverId) || map.get(clientId) || map.get(id);
      if (!st) return x;

      const nowStatus =
        (st.status === "public")  ? "approved" :
        (st.status === "pending") ? "pending"  :
        (st.status === "missing") ? "missing"  :
        prev;

      if (prev !== "approved" && nowStatus === "approved") becameApproved++;

      return { ...x, status: nowStatus, approvedAt: st.approvedAt ?? x.approvedAt ?? null };
    });

    const cleaned = next.filter(x => {
      const st = String(x?.status || "");
      return (st !== "approved" && st !== "missing");
    });

    localStorage.setItem(key, JSON.stringify(cleaned));

    if (becameApproved > 0) {
      try {
        localStorage.setItem("fw_on_next_search", JSON.stringify({
          ts: Date.now(),
          count: becameApproved
        }));
      } catch {}
    }

    try{ renderMySubmissions(); }catch{}
  }catch(e){
    console.warn("syncMySubmissionsStatus error", e);
  }
}

// ==============================
// ✅ 自分の投稿：localStorage
// ==============================
function saveMySubmission(item){
  const key = "my_submissions";
  const list = JSON.parse(localStorage.getItem(key) || "[]");

  list.unshift(item);

  const MAX = 1000;
  if (list.length > MAX) list.length = MAX;

  localStorage.setItem(key, JSON.stringify(list));
}

// ==============================
// ✅ 自分の投稿表示
// ==============================
function renderMySubmissions(){
  const listEl = document.getElementById("my-submissions-list");
  if (!listEl) return;

  const list = JSON.parse(localStorage.getItem("my_submissions") || "[]");

  if (!list.length){
    listEl.innerHTML = `<div class="muted">まだ投稿はありません</div>`;
    return;
  }

  listEl.innerHTML = list
    .slice(0, 30)
    .map(item => {
      const id = String(item?.id || "");
      const st = String(item?.status || "pending");

      const isLocal = id.startsWith("local_");
      const isMissing = (st === "missing");

      const statusLabel =
        (st === "approved")
          ? `<span style="color:#16a34a;font-weight:900;">採用</span>`
          : (isLocal || isMissing)
            ? `<span style="color:#64748b;font-weight:900;">同期不可</span>`
            : `<span style="color:#f59e0b;font-weight:900;">承認中</span>`;

      const note =
        isLocal
          ? `<div class="muted" style="margin-top:4px;font-size:11px;">※この投稿は local_ のため承認状態を自動更新できません</div>`
          : isMissing
            ? `<div class="muted" style="margin-top:4px;font-size:11px;">※サーバ側にIDが見つかりません（/api/status=missing）。worker.js の保存キー/参照キーが一致しているか確認してください</div>`
            : "";

      return `
        <div style="
          border:1px solid rgba(15,23,42,.12);
          border-radius:12px;
          padding:10px;
          margin-bottom:8px;
          background:#fff;
        ">
          <div style="font-size:14px; white-space:pre-wrap;">${escapeHtml(String(item.text || ""))}</div>
          <div class="muted" style="margin-top:6px;font-size:12px;">
            状態：${statusLabel}
          </div>
          ${note}
        </div>
      `;
    })
    .join("");
}

// ==============================
// ✅ 初期化
// ==============================
async function init(){
  try { ensureRankingDom(); } catch {}
  try { ensureReindexHintDom(); } catch {}
  try { await loadSharedJSON(); } catch {}
  try { wireSubmit(); } catch (e) { console.warn(e); }

  try { ensureMySubmissionsDom(); } catch {}
  try { renderMySubmissions(); } catch {}
  try { await syncMySubmissionsStatus(); } catch {}
  try { setInterval(syncMySubmissionsStatus, 30000); } catch {}

  try{
    const rankingKey = getRankingKeyNow();
    await renderRankingOnce(rankingKey);
  }catch(e){
    console.warn("init renderRankingOnce error", e);
  }

  try{
    renderEmpty();
  }catch(e){
    console.warn("init renderEmpty error", e);
  }
}

if (document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", init, { once:true });
} else {
  init();
}

// # END
  
