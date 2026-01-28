// script.js
// ✅ API_BASE（あなたのPCで /api/health がOKだった“正”）
const API_BASE = "https://ancient-union-4aa4tatoete-kousui-api.y-yoshioka27.workers.dev";

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
// ✅ いいね（Workers）
// ==============================
async function sendLikeToServer(publicId){
  const res = await fetch(`${API_BASE}/api/like`, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ id: publicId })
  });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `like failed ${res.status}`);
  return data; // {ok,id,likesToday}
}

// ==============================
// ✅ 今日のランキング（Workers）
// ==============================
async function fetchTodayRanking({ mode, bucket, limit = 3 }){
  const params = new URLSearchParams();
  params.set("mode", mode === "fun" ? "fun" : "trivia");
  params.set("bucket", String(window.bucket10(bucket)));
  params.set("limit", String(Math.max(1, Math.min(50, Number(limit || 3)))));

  const url = `${API_BASE}/api/ranking/today?${params.toString()}`;
  const res = await fetch(url, { method: "GET" });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `ranking failed ${res.status}`);
  return data.items || []; // [{id,text,likes,penName}]
}

// ==============================
// 共有ネタ（GitHub PagesのJSON / metaphors.js）
// ==============================
const SHARED_JSON_URL = "./metaphors.json";
let sharedItems = []; // [{mode,bucket,text}, ...]

// 互換用（過去に入れた人向け）
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
// ✅ 共有ネタ（Cloudflare Workers /api/public）
// - public を抽選候補へ混ぜる
// - mode×bucket のキャッシュ
// ==============================
const publicCache = new Map(); // key: "mode_bucket" => [{text,id,penName?}, ...]
// 互換：/api/public は text しか返していないので id は null のまま（like送信はできない）
function keyMB(mode, bucket){
  const m = (mode === "fun" ? "fun" : "trivia");
  const b = window.bucket10(bucket);
  return `${m}_${b}`;
}

async function warmPublicCache(mode, bucket){
  const k = keyMB(mode, bucket);
  if (publicCache.has(k)) return;

  try{
    // 現状 /api/public は text のみ取り出し → idは不明
    const texts = await fetchPublicMetaphors({
      mode: (mode === "fun" ? "fun" : "trivia"),
      bucket: window.bucket10(bucket),
      limit: 200
    });
    publicCache.set(k, texts.map(t => ({ text: String(t||"").trim(), id: null, penName: null })));
  }catch{
    publicCache.set(k, []);
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
  return arr.map(x => ({
    text: String(x?.text || "").trim(),
    extraId: x?.id || null,     // ✅ publicId（あれば）
    penName: x?.penName || null
  })).filter(x => x.text);
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
    m: { text: null, extraId: null, penName: null },
    d: { text: null, extraId: null, penName: null },
    e: { text: null, extraId: null, penName: null }
  },
  lastMain: { text: null, animToken: 0 } // 例えを変える用
};

const $ = (id) => document.getElementById(id);

// =========================
// 👍（ローカル）人気度：出やすくする
// ※ 仕様変更していないので維持（不要なら後で一括OFF可能）
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
// ネタ抽選（既存 + 共有(JSON) + 共有(public) を混ぜる）
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

  const baseTexts = getBaseTexts(mode, b).map(t => ({ text: t, extraId: null, penName: null }));
  const shared = getSharedItems(mode, b).map(x => ({ text: x.text, extraId: null, penName: null }));
  const pub    = getPublicItems(mode, b);

  const out = [];
  const seen = new Set();
  for (const item of [...baseTexts, ...shared, ...pub]) {
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
    return like + 1; // 最低1
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
  if (!pool.length) return { text: "データなし", extraId: null, penName: null };

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
// 👍 UI（表示中の3つ）
// - ローカルに加えて /api/like にも送る（idが分かる場合だけ）
// =========================
function updateLikeUI(slot) {
  const phraseObj = state.currentPhrases[slot];
  const phrase = phraseObj?.text;

  const countEl = document.getElementById(`likeCount_${slot}`);
  const badgeEl = document.getElementById(`badge_${slot}`);
  const btnEl = document.getElementById(`like_${slot}`);

  if (!btnEl) return;

  if (!phrase || phrase === "データなし") {
    if (countEl) countEl.textContent = "0";
    if (badgeEl) badgeEl.textContent = "";
    btnEl.disabled = true;
    btnEl.onclick = null;
    return;
  }

  const count = getLikesFor(phrase);
  if (countEl) countEl.textContent = String(count);

  if (badgeEl) badgeEl.textContent = (count >= 5 ? "⭐候補！" : "");

  btnEl.disabled = false;
  btnEl.onclick = async () => {
    // まずローカル加算（オフラインでも効く）
    incrementLike(phrase);
    updateLikeUI(slot);
    render(); // 出やすさ反映

    // サーバへも送る（publicIdがある場合のみ）
    const publicId = phraseObj?.extraId || null;
    if (!publicId) {
      // publicId不明（metaphors.js / shared JSON / text-only public 由来）なら送れない
      // ここは何も言わない（静かにローカルだけ効かせる）
      return;
    }

    // 二重クリック対策（短時間はボタンを軽くロック）
    btnEl.disabled = true;
    try {
      await sendLikeToServer(publicId);
      // ✅ いいね成功したらランキングを更新
      await updateRankingUI();
    } catch (e) {
      // 429(日次上限)などもここに来る
      try {
        showTempInfo(`⚠️ いいね送信：${e?.message || e}`);
      } catch {}
    } finally {
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
// ✅ CSS注入（ふわーっと浮き上がる）
// =========================
(function injectAnimCSS(){
  if (document.getElementById("animCSS_v1")) return;
  const style = document.createElement("style");
  style.id = "animCSS_v1";
  style.textContent = `
    .floatChange{
      animation: floatChange .42s ease-out both;
    }
    @keyframes floatChange{
      0%   { opacity: .55; transform: translateY(10px); filter: blur(0.3px); }
      100% { opacity: 1;   transform: translateY(0px); filter: blur(0px); }
    }
    .rankBox{
      margin-top: 10px;
      border: 1px solid rgba(15,23,42,0.08);
      border-radius: 14px;
      padding: 12px 12px;
      background: rgba(255,255,255,0.72);
    }
    .rankTitle{
      font-size: 13px;
      color: #475569;
      font-weight: 700;
      margin-bottom: 8px;
      display:flex;
      align-items:center;
      justify-content: space-between;
      gap: 10px;
    }
    .rankItems{
      display:flex;
      flex-direction: column;
      gap: 8px;
    }
    .rankItem{
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid rgba(15,23,42,0.08);
      background: rgba(255,255,255,0.86);
      display:flex;
      flex-direction: column;
      gap: 6px;
    }
    .rankTopRow{
      display:flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
    }
    .rankText{
      font-size: 14px;
      line-height: 1.55;
      font-weight: 700;
      color: #0f172a;
    }
    .rankMeta{
      font-size: 12px;
      color: #64748b;
      display:flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .rankBadge{
      font-size: 12px;
      font-weight: 800;
    }
    .rankMuted{
      font-size: 12px;
      color: #64748b;
    }
    .tempInfo{
      margin-top: 8px;
      font-size: 12px;
      color: #64748b;
    }
    .penInput{
      max-width: 260px;
    }
  `;
  document.head.appendChild(style);
})();

// =========================
// ✅ 一時メッセージ（軽く通知）
// =========================
let tempInfoTimer = null;
function showTempInfo(msg){
  const host = ensureRankingHost(); // ボタン下に出す
  if (!host) return;

  let el = document.getElementById("tempInfo");
  if (!el) {
    el = document.createElement("div");
    el.id = "tempInfo";
    el.className = "tempInfo";
    host.appendChild(el);
  }
  el.textContent = msg;

  if (tempInfoTimer) clearTimeout(tempInfoTimer);
  tempInfoTimer = setTimeout(() => {
    try { el.textContent = ""; } catch {}
  }, 3500);
}

// =========================
// ✅ ランキングUI（refreshボタンの直下に出す）
// =========================
function ensureRankingHost(){
  const refreshBtn = document.getElementById("refresh");
  if (!refreshBtn) return null;
  const actions = refreshBtn.closest(".actions") || refreshBtn.parentElement;
  if (!actions) return null;

  // ranking box は actions の直後に置く（「ボタンの下」）
  let host = document.getElementById("rankingHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "rankingHost";
    host.className = "rankBox";
    // actions の次に挿入
    if (actions.nextSibling) actions.parentElement.insertBefore(host, actions.nextSibling);
    else actions.parentElement.appendChild(host);
  }
  return host;
}

function renderRankingSkeleton(){
  const host = ensureRankingHost();
  if (!host) return;

  const mode = getSelectedMode();
  const bucket = getCurrentFocusBucket();

  const title = (mode === "fun") ? "今日のお笑いランキング" : "今日の雑学ランキング";

  host.innerHTML = `
    <div class="rankTitle">
      <div>🏆 ${title} BEST3（${bucket}%）</div>
      <div class="rankMuted" id="rankStatus">取得中…</div>
    </div>
    <div class="rankItems" id="rankItems"></div>
  `;
}

function getCurrentFocusBucket(){
  // 「今選んでいる確率」＝画面で一番メインになっているやつ
  // あなたの仕様：朝昼夜のうち最大の降水確率で例えが決まっている → そのbucketを採用
  if (!state?.pops) return 0;
  const m = state.pops.m;
  const d = state.pops.d;
  const e = state.pops.e;
  const arr = [m,d,e].filter(v => v != null);
  if (!arr.length) return 0;
  return window.bucket10(Math.max(...arr));
}

function rankBadgeByIndex(i){
  if (i === 0) return "🥇";
  if (i === 1) return "🥈";
  if (i === 2) return "🥉";
  return "🏅";
}

function escapeHtml(s){
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function updateRankingUI(){
  const host = ensureRankingHost();
  if (!host) return;

  // popsがないならランキングも空
  if (!state?.pops) {
    host.innerHTML = `
      <div class="rankTitle">
        <div>🏆 今日のランキング BEST3</div>
        <div class="rankMuted">地点未選択</div>
      </div>
      <div class="rankMuted">地点を選ぶとランキングを表示します。</div>
    `;
    return;
  }

  renderRankingSkeleton();

  const mode = getSelectedMode();
  const bucket = getCurrentFocusBucket();

  const statusEl = document.getElementById("rankStatus");
  const itemsEl = document.getElementById("rankItems");

  try{
    const items = await fetchTodayRanking({ mode, bucket, limit: 3 });

    if (statusEl) statusEl.textContent = "更新";

    if (!itemsEl) return;

    if (!items.length) {
      itemsEl.innerHTML = `
        <div class="rankMuted">
          まだ「今日のいいね」がありません。最初の一票をどうぞ👍
        </div>
      `;
      return;
    }

    itemsEl.innerHTML = items.map((it, idx) => {
      const badge = rankBadgeByIndex(idx);
      const pen = it.penName ? `✍️ ${escapeHtml(it.penName)}` : "";
      const likes = Number(it.likes || 0);
      return `
        <div class="rankItem">
          <div class="rankTopRow">
            <div class="rankText"><span class="rankBadge">${badge}</span> ${escapeHtml(it.text)}</div>
            <div class="rankMuted">👍 ${likes}</div>
          </div>
          <div class="rankMeta">
            ${pen ? `<span>${pen}</span>` : `<span class="rankMuted">（ペンネームなし）</span>`}
          </div>
        </div>
      `;
    }).join("");

  }catch(e){
    if (statusEl) statusEl.textContent = "取得失敗";
    if (itemsEl) itemsEl.innerHTML = `
      <div class="rankMuted">⚠️ ランキング取得に失敗：${escapeHtml(e?.message || e)}</div>
    `;
  }
}

// =========================
// render
// =========================
function render() {
  const hintEl = document.getElementById("popHint");
  const sourceTag = document.getElementById("sourceTag");
  const tzTag = document.getElementById("tzTag");

  // ★ 「人間向け翻訳」DOMが消えても落ちないようにする
  const metaAll = document.getElementById("metaphor"); // 無ければ null
  const footEl = document.getElementById("metaFoot");  // 無ければ null

  if (sourceTag) sourceTag.textContent = state.source;
  if (tzTag) tzTag.textContent = state.tz ? `TZ: ${state.tz}` : "TZ: --";

  const setSlot = (slotKey, value, label) => {
    const popEl = document.getElementById(`pop_${slotKey}`);
    const metaEl = document.getElementById(`meta_${slotKey}`);

    if (value == null) {
      if (popEl) popEl.textContent = "--%";
      if (metaEl) metaEl.textContent = "データなし";

      setIcon(slotKey, null);

      state.currentPhrases[slotKey] = { text: null, extraId: null, penName: null };
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

    state.currentPhrases[slotKey] = { text: picked.text, extraId: picked.extraId, penName: picked.penName };
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
    // ランキングも更新
    try { updateRankingUI(); } catch {}
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
    const mainText = `【${maxOne.label}】${maxOne.value}% → ${maxOne.text}`;

    // 「例えを変える」対象（メイン文）を保持
    state.lastMain.text = mainText;

    // メイン表示（人間向け翻訳欄を消してもOK）
    if (metaAll) metaAll.textContent = mainText;
  }

  if (footEl) footEl.textContent =
    "※降水確率を0/10/…/100%に丸め、既存ネタ＋共有(JSON)＋共有(public)からランダム表示（👍が多いほど出やすい）";

  // ✅ ランキング更新（今のbucketで）
  try { updateRankingUI(); } catch {}
}

function renderEmpty() {
  const metaAll = document.getElementById("metaphor");

  ["m","d","e"].forEach(k => {
    const popEl = document.getElementById(`pop_${k}`);
    const metaEl = document.getElementById(`meta_${k}`);

    if (popEl) popEl.textContent = "--%";
    if (metaEl) metaEl.textContent = "データなし";

    setIcon(k, null);

    state.currentPhrases[k] = { text: null, extraId: null, penName: null };
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

        // public候補も先読み
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

// =========================
// ✅ 「例えを変える」ボタン
// - 人間向け翻訳DOMが消えても落ちない
// - ふわーっと浮き上がるアニメ
// - ランキングは「今の確率(bucket)」のまま（変わらない）
// =========================
document.getElementById("refresh").onclick = () => {
  // renderすると、メイン文も再抽選される（最大確率のbucketのネタが変わる）
  render();

  const metaAll = document.getElementById("metaphor");
  if (metaAll) {
    // アニメ付け直し（連打対応：classを外して付ける）
    metaAll.classList.remove("floatChange");
    // 強制リフロー
    void metaAll.offsetWidth;
    metaAll.classList.add("floatChange");
  }
  // ランキングも更新（同一bucketだが、いいね状況が変わっている可能性がある）
  try { updateRankingUI(); } catch {}
};

// ==============================
// ✅ ネタ追加（承認待ちへ送信 一本化）
// - submitPendingBtn を押したら即 /api/submit
// - ペンネーム欄はJS側で自動生成（HTMLを触らなくても出る）
// ==============================
(function setupSubmitPending(){
  const btn = document.getElementById("submitPendingBtn");
  if (!btn) return;

  // ✅ ペンネーム入力欄を「確率selectの近く」に追加（無ければ生成）
  (function ensurePenNameUI(){
    const modeSel = document.getElementById("newPhraseMode");
    const bucketSel = document.getElementById("newPhraseBucket");
    const actionsWrap = btn.closest(".actions") || btn.parentElement;
    if (!actionsWrap) return;

    if (document.getElementById("penName")) return;

    const label = document.createElement("label");
    label.className = "small";
    label.textContent = "ペンネーム：";

    const input = document.createElement("input");
    input.id = "penName";
    input.className = "penInput";
    input.placeholder = "例：ひらめき君 / 匿名でもOK";
    input.autocomplete = "nickname";

    // bucketの後ろに差し込む（なければ末尾）
    if (bucketSel && bucketSel.nextSibling) {
      actionsWrap.insertBefore(label, bucketSel.nextSibling);
      actionsWrap.insertBefore(input, label.nextSibling);
    } else {
      actionsWrap.appendChild(label);
      actionsWrap.appendChild(input);
    }
  })();

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
      await submitToPending(mode, bucket, text, penName || null);

      if (statusEl) statusEl.textContent =
        "✅ 送信しました。承認されると一般公開されます。";

      const ta = document.getElementById("newPhrase");
      if (ta) ta.value = "";
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
render();

loadSharedJSON().then(() => {
  render();
});

// 初回：ランキング枠だけ先に作っておく（地点選択前でも「地点未選択」を出す）
try { updateRankingUI(); } catch {}

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
