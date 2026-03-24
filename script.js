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
const BUILD = "2026-03-24_hof_cache_sync_patch_v13";

// ✅ API_BASE（/api/health がOKの“正”）
const API_BASE = "https://ancient-union-4aa4tatoete-kousui-api.y-yoshioka27.workers.dev";

// ✅ 殿堂入り日次スナップショット（GitHub Pages側に1日1回だけ配置）
const HOF_DAILY_JSON_URL = `${API_BASE}/api/hof_daily`;
const HOF_DAILY_CACHE_KEY = "hof_daily_cache_v2";
let __hofSnapshotMemory = null;
let __hofSnapshotHtml = null;

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
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit"
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}
function getUsageDeviceId(){
  let id = localStorage.getItem("usage_device_id_v1");
  if(!id){
    id = (crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    localStorage.setItem("usage_device_id_v1", id);
  }
  return id;
}
async function pingUsageOncePerDay(reason = "weather_ok"){
  try{
    const today = todayJSTString();
    if (localStorage.getItem("usage_ping_day_v1") === today) return;

    const d = getUsageDeviceId();
    const url = `${API_BASE}/api/usage/ping?d=${encodeURIComponent(d)}&reason=${encodeURIComponent(reason)}&build=${encodeURIComponent(BUILD)}`;

    let ok = false;
    try{
      const r = await fetch(url, { cache: "no-store" });
      ok = r.ok;
    }catch(_){ }

    if (!ok) {
      try{
        const r2 = await fetch(`${API_BASE}/api/usage/ping`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ d, reason, build: BUILD })
        });
        ok = r2.ok;
      }catch(_){ }
    }

    if (ok) localStorage.setItem("usage_ping_day_v1", today);
  }catch(_){ }
}

// =========================
// ✅ 添付/直打ちメタファーのフォールバック
// （metaphors.js が未読込でも最低限動く）
// =========================
window.METAPHORS = window.METAPHORS || {
  0: [
    "傘の出番がない日の予定",
    "冷蔵庫の製氷機の休暇",
    "砂漠の水たまり",
    "会議で全員が一言で終わる確率"
  ],
  10: [
    "ATMで旧札が混ざる確率",
    "エレベーターが一発で来る感じ",
    "信号が青続きで着く朝",
    "会議が定時で終わる見込み"
  ],
  20: [
    "カレーうどんで白シャツが無事な見込み",
    "スーパーでレジ待ちが短い感じ",
    "ガチャで欲しいのが来る雰囲気",
    "洗車した日に降られない期待"
  ],
  30: [
    "席替えで窓側を引く感じ",
    "動画の広告が1本で済む確率",
    "居酒屋で静かな席に通される見込み",
    "会議で雑談だけで終わらない可能性"
  ],
  40: [
    "昼休みに外へ出たらちょうど晴れる感じ",
    "駐車場で入口近くが空いている見込み",
    "コンビニで温めが絶妙な感じ",
    "今日の仕事が“そこそこ”進む期待"
  ],
  50: [
    "コイントスくらい",
    "洗濯するか迷う空",
    "じゃんけん一発勝負",
    "会議で結論が出るか出ないか"
  ],
  60: [
    "アラーム1回で起きられる見込み",
    "人気店に並んでも思ったより早い感じ",
    "買った傘を今年それなりに使う確率",
    "上司の機嫌がまずまずな日"
  ],
  70: [
    "テストで“たぶん大丈夫”な手応え",
    "週末の予定がそのまま実行される見込み",
    "冷凍ご飯がちょうどよく温まる感じ",
    "今日の作業が予定線まで行く期待"
  ],
  80: [
    "ほぼ当たりのくじ",
    "目的の店が開いてる安心感",
    "電車で座れそうな気配",
    "締切前日にちゃんと焦り始める確率"
  ],
  90: [
    "通知を見たらだいたい仕事の連絡",
    "朝コンビニでコーヒーを買う流れ",
    "月曜に“まだ休みたい”と思う感じ",
    "会議で誰かが『一旦持ち帰ります』と言う確率"
  ],
  100: [
    "蛇口をひねったら水が出るくらい確実",
    "月曜の朝に眠いのと同じ",
    "カップ麺にお湯を入れたら待つ展開",
    "会議が延びるときの延び方"
  ]
};

window.FUN_METAPHORS = window.FUN_METAPHORS || {
  0: [
    "二度寝してから始発に間に合う人",
    "会議中に寝てたのに議事録係に選ばれる人",
    "冷蔵庫を開けただけで痩せる人",
    "財布を忘れたのに堂々と会計を終える人"
  ],
  10: [
    "エレベーターの『閉』を押した瞬間に誰も来ない日",
    "雨雲レーダーを見て洗濯したら本当に助かる日",
    "コンビニで温め時間がちょうどいい日",
    "会社で『一言だけ』の話が本当に一言で終わる日"
  ],
  20: [
    "寝坊したのに、なぜか余裕の顔で到着する人",
    "レシートを捨てた瞬間に返品したくなる日",
    "会議で『それ前も言いました』が優しく聞こえる日",
    "USBを一回で正しく挿せる人"
  ],
  30: [
    "やる気スイッチが朝から見つかる日",
    "置いた場所を覚えてるままメガネを探さない人",
    "スーパーで一番速いレジを一発で引く人",
    "昼休みに外へ出ただけで人生が整う人"
  ],
  40: [
    "『あと5分』で本当に5分だけ休む人",
    "買った傘をその日のうちに無くさない人",
    "上司の『軽く相談』が軽かった日",
    "会議資料を印刷したらページ順が完璧な日"
  ],
  50: [
    "ちょうど半々の運",
    "やる気と眠気が引き分けてる朝",
    "今日いける気もするし無理な気もする感じ",
    "定時で帰れるか、ひと仕事増えるかの境目"
  ],
  60: [
    "アラーム1回で起きてそのまま活動する人",
    "洗濯物を干した直後に雨を呼ばない人",
    "会議で『一旦整理しましょう』が本当に整理になる日",
    "靴下が片方だけ消えない朝"
  ],
  70: [
    "『今日はツイてる』が夕方まで続く日",
    "買い物メモを忘れず、その紙も無くさない人",
    "電車で座れそうな場所に立てる人",
    "レンジで温めたご飯が端までちゃんと温かい日"
  ],
  80: [
    "かなりいい流れの日",
    "仕事も雑談もほどよくうまくいく日",
    "提出直前で誤字に自力で気づける人",
    "休憩のつもりが本当に休憩で終わる日"
  ],
  90: [
    "ほぼそうなる日",
    "月曜の朝に眠いくらい確実",
    "通知を見たら仕事の連絡なくらいの確率",
    "会議で誰かが『持ち帰ります』と言う日"
  ],
  100: [
    "ほぼ確定の流れ",
    "蛇口をひねれば水が出るくらい自然",
    "締切前日に急に本気を出す感じ",
    "カップ麺にお湯を入れたら待つのと同じ"
  ]
};

// =========================
// ✅ ユーティリティ
// =========================
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function bucket10(n){
  n = Number(n);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n / 10) * 10));
}
window.bucket10 = bucket10;

function normText(s){
  return String(s || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMetaphorText(s){
  return normText(s)
    .replace(/[：:]\s*\d+％?$/u, "")
    .replace(/[：:]\s*\d+%$/u, "")
    .trim();
}

function normalizePenName(v){
  const s = String(v || "").normalize("NFKC").trim();
  return s || "";
}

function isNgText(text){
  const t = normText(text).toLowerCase();
  if (!t) return true;
  const ng = [
    "共通テスト"
  ];
  return ng.some(x => t.includes(String(x).toLowerCase()));
}

function toModeLabel(mode){
  return mode === "fun" ? "お笑い" : "雑学";
}

function escHtml(s){
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dayKeyJST(d = new Date()){
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit"
  });
  return fmt.format(d);
}

function makeGlobalId({ mode, bucket, text, source }){
  const m = String(mode || "trivia");
  const b = String(bucket10(bucket));
  const t = normalizeMetaphorText(text);
  const s = String(source || "seed");
  return `${m}__${b}__${t}__${s}`;
}

function canonicalId(mode, text){
  const key = `${mode || "trivia"}|${normalizeMetaphorText(text)}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return `cid_${(h >>> 0).toString(16)}`;
}

function isSeedLike(item){
  const id = String(item?.id || "");
  const source = String(item?.source || "").toLowerCase();
  const pen = String(item?.penName || "");
  return (
    id.startsWith("seedjs_") ||
    source === "seed" ||
    pen.includes("元ネタ")
  );
}

function currentMode(){
  const v = document.querySelector('input[name="mode"]:checked')?.value;
  return v === "fun" ? "fun" : "trivia";
}

function modeMetaphors(mode){
  return mode === "fun" ? window.FUN_METAPHORS : window.METAPHORS;
}

// =========================
// ✅ state
// =========================
const state = {
  region: "",
  pointName: "",
  lat: null,
  lon: null,
  weatherCode: null,
  precipProb: null,
  currentPhrases: { m: null, d: null, e: null },
  hofThreshold: 20,
};

const publicCache = new Map();
let __rankRenderToken = 0;

// =========================
// ✅ localStorage cache
// =========================
function saveJson(key, data){
  try{ localStorage.setItem(key, JSON.stringify(data)); }catch(_){}
}
function loadJson(key, fallback = null){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch(_){
    return fallback;
  }
}
function loadHallDailyCache(){
  return loadJson(HOF_DAILY_CACHE_KEY, null);
}
function saveHallDailyCache(data){
  saveJson(HOF_DAILY_CACHE_KEY, data);
}

// =========================
// ✅ weather helpers
// =========================
function weatherCodeLabel(code){
  const map = {
    0: "快晴",
    1: "晴れ",
    2: "晴れ時々くもり",
    3: "くもり",
    45: "霧",
    48: "霧氷",
    51: "弱い霧雨",
    53: "霧雨",
    55: "強い霧雨",
    61: "弱い雨",
    63: "雨",
    65: "強い雨",
    71: "弱い雪",
    73: "雪",
    75: "大雪",
    80: "にわか雨",
    81: "雨がち",
    82: "激しいにわか雨",
    95: "雷雨"
  };
  return map[code] || "天気";
}

// =========================
// ✅ public API
// =========================
async function apiGet(path){
  const r = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if(!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}

async function apiPost(path, body, headers = {}){
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if(!r.ok) throw new Error(j?.error || `${path} ${r.status}`);
  return j;
}

async function likeAny(payload){
  return apiPost("/api/like", payload, {
    "x-client-id": payload.clientId || getClientId()
  });
}

async function fetchPublic(mode, bucket){
  const b = bucket10(bucket);
  const key = `${mode}:${b}`;
  if (publicCache.has(key)) return publicCache.get(key);

  const items = await apiGet(`/api/public?mode=${encodeURIComponent(mode)}&bucket=${b}`);
  const arr = Array.isArray(items) ? items : (Array.isArray(items?.items) ? items.items : []);
  const normalized = arr.map(it => ({
    ...it,
    mode: mode,
    bucket: b,
    totalLikes: Number(it?.totalLikes || it?.likes_total || 0),
    likesToday: Number(it?.likes || it?.likesToday || 0),
  }));
  publicCache.set(key, normalized);
  return normalized;
}

async function fetchRankingToday(mode, bucket, limit = 10){
  const b = bucket10(bucket);
  const q = mode ? `?mode=${encodeURIComponent(mode)}&bucket=${b}&limit=${limit}` : `?limit=${limit}`;
  const res = await apiGet(`/api/ranking/today${q}`);
  return Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
}

async function fetchRankingTotal(mode, bucket, limit = 10){
  const b = bucket10(bucket);
  const q = mode ? `?mode=${encodeURIComponent(mode)}&bucket=${b}&limit=${limit}` : `?limit=${limit}`;
  const res = await apiGet(`/api/ranking/total${q}`);
  return Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
}

async function fetchHallOfFame(mode, bucket = 0, limit = 20){
  const b = bucket10(bucket);
  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("bucket", b);
  params.set("limit", limit);
  const res = await apiGet(`/api/hof?${params.toString()}`);
  const items = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
  return items.map(it => ({
    ...it,
    mode,
    bucket: Number.isFinite(Number(it?.bucket)) ? bucket10(Number(it.bucket)) : b,
    totalLikes: Number(it?.totalLikes || it?.likes_total || 0),
    likesToday: Number(it?.likes || it?.likesToday || 0),
    hof: true
  }));
}

async function fetchHallOfFameDaily(limit = 100){
  const res = await fetch(HOF_DAILY_JSON_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`hof_daily ${res.status}`);
  const j = await res.json();
  const items = Array.isArray(j?.items) ? j.items : [];
  state.hofThreshold = Number(j?.hofThreshold || state.hofThreshold || 20);
  return {
    generatedAt: j?.generatedAt || null,
    hofThreshold: Number(j?.hofThreshold || state.hofThreshold || 20),
    items: items.slice(0, limit).map(normalizeHallSnapshotItem).filter(Boolean)
  };
}

function normalizeHallSnapshotItem(it){
  if (!it) return null;
  const mode = (it.mode === "fun") ? "fun" : "trivia";
  const bucket = Number.isFinite(Number(it.bucket)) ? bucket10(Number(it.bucket)) : 0;
  const text = String(it.text || "").trim();
  if (!text) return null;
  return {
    id: String(it.id || makeGlobalId({ mode, bucket, text, source: it.source || "snapshot" })),
    text,
    penName: it.penName ? String(it.penName).trim() : null,
    totalLikes: Number(it.totalLikes || it.likes_total || 0),
    likes: Number(it.likes || it.likesToday || 0),
    bucket,
    mode,
    hof: true,
    source: it.source || "snapshot"
  };
}

function mergeDisplayItems(items){
  const map = new Map();

  for (const raw of (Array.isArray(items) ? items : [])) {
    if (!raw?.text) continue;
    const mode = raw.mode === "fun" ? "fun" : "trivia";
    const text = String(raw.text).trim();
    if (!text || isNgText(text)) continue;

    const cid = canonicalId(mode, text);
    const prev = map.get(cid);

    const next = {
      id: String(raw.id || cid),
      canonicalId: cid,
      text,
      penName: raw.penName ? String(raw.penName).trim() : null,
      totalLikes: Number(raw.totalLikes || raw.likes_total || 0),
      likes: Number(raw.likes || raw.likesToday || 0),
      bucket: Number.isFinite(Number(raw.bucket)) ? bucket10(Number(raw.bucket)) : 0,
      mode,
      hof: !!raw.hof,
      source: raw.source || "public",
      seedLike: isSeedLike(raw)
    };

    if (!prev) {
      map.set(cid, next);
      continue;
    }

    const betterId = !prev.seedLike && next.seedLike ? prev.id
      : (prev.seedLike && !next.seedLike ? next.id
      : prev.id);

    map.set(cid, {
      ...prev,
      ...next,
      id: betterId,
      totalLikes: Math.max(Number(prev.totalLikes || 0), Number(next.totalLikes || 0)),
      likes: Math.max(Number(prev.likes || 0), Number(next.likes || 0)),
      hof: !!prev.hof || !!next.hof,
      penName: prev.penName || next.penName || null,
      source: (!prev.seedLike && next.seedLike) ? prev.source
            : (prev.seedLike && !next.seedLike) ? next.source
            : prev.source,
      seedLike: prev.seedLike && next.seedLike
    });
  }

  return [...map.values()];
}

function buildRankingItemHtml(it, rank, kind = "today"){
  const total = Number(it.totalLikes || 0);
  const likes = Number(it.likes || it.likesToday || 0);
  const modeLabel = toModeLabel(it.mode);
  const pen = it.penName ? ` / ${escHtml(it.penName)}` : "";
  const meta = kind === "today"
    ? `今日 ${likes} / 累計 ${total}`
    : `累計 ${total}`;
  return `
    <div class="rank-item">
      <div class="rank-no">${rank}</div>
      <div class="rank-main">
        <div class="rank-text">${escHtml(it.text)}</div>
        <div class="rank-meta">${modeLabel}${pen} / ${meta}</div>
      </div>
    </div>
  `;
}

function buildHallCardHtmlFromSnapshot(hofData){
  const items = Array.isArray(hofData?.items) ? hofData.items : [];
  const threshold = Number(hofData?.hofThreshold || state.hofThreshold || 20);
  const generatedAt = hofData?.generatedAt ? `生成: ${escHtml(hofData.generatedAt)}` : "生成: -";

  const rows = items.length
    ? items.map((it, i) => buildRankingItemHtml(it, i + 1, "total")).join("")
    : `<div class="rank-empty">殿堂入りはまだありません</div>`;

  return `
    <section class="rank-card" id="rankHofCard">
      <div class="rank-head">
        <h3>殿堂入り</h3>
        <div class="rank-sub">累計 ${threshold} 以上 / ${generatedAt}</div>
      </div>
      <div class="rank-body">${rows}</div>
    </section>
  `;
}

function canonMode(mode){
  return (mode === "fun") ? "fun" : "trivia";
}

function canonBucket(bucket){
  return Number.isFinite(Number(bucket)) ? window.bucket10(Number(bucket)) : 0;
}

function sameCanonicalMetaphor(a, b){
  const am = canonMode(a?.mode);
  const bm = canonMode(b?.mode);
  if (am !== bm) return false;

  const at = normalizeMetaphorText(a?.text || "");
  const bt = normalizeMetaphorText(b?.text || "");
  return !!at && at === bt;
}

function refreshHallSnapshotHtml(){
  try{
    const base = (__hofSnapshotMemory && Array.isArray(__hofSnapshotMemory.items))
      ? __hofSnapshotMemory
      : {
          day: todayJSTString(),
          generatedAt: null,
          hofThreshold: Number(state.hofThreshold || 20),
          items: []
        };

    base.hofThreshold = Number(state.hofThreshold || base.hofThreshold || 20);
    __hofSnapshotHtml = buildHallCardHtmlFromSnapshot(base);

    const el = document.getElementById("rankHofCard");
    if (el && __hofSnapshotHtml) {
      el.outerHTML = __hofSnapshotHtml;
    }
  }catch(e){
    console.warn("refreshHallSnapshotHtml error", e);
  }
}

function syncLikedItemToCaches(liked){
  try{
    if (!liked?.text) return;

    const nextMode  = canonMode(liked.mode);
    const nextBucket = canonBucket(liked.bucket);
    const nextToday = Number(liked.likesToday || 0);
    const nextTotal = Number(liked.totalLikes || 0);
    const nextHof   = !!liked.hof || (nextTotal >= Number(state.hofThreshold || 20));

    // 1) 画面上の3枠へ反映
    for (const slot of ["m", "d", "e"]) {
      const cur = state.currentPhrases?.[slot];
      if (!cur?.text) continue;
      if (!sameCanonicalMetaphor(cur, liked)) continue;

      state.currentPhrases[slot] = {
        ...cur,
        mode: nextMode,
        bucket: canonBucket(cur.bucket ?? nextBucket),
        likesToday: Math.max(Number(cur.likesToday || 0), nextToday),
        totalLikes: Math.max(Number(cur.totalLikes || 0), nextTotal),
        hof: !!cur.hof || nextHof
      };
      updateLikeUI(slot);
    }

    // 2) publicCacheへ反映
    for (const [k, arr] of publicCache.entries()) {
      if (!Array.isArray(arr)) continue;

      publicCache.set(k, arr.map(it => {
        if (!it?.text) return it;
        const candidate = { ...it, mode: it?.mode || nextMode };
        if (!sameCanonicalMetaphor(candidate, liked)) return it;

        return {
          ...it,
          mode: canonMode(it?.mode || nextMode),
          bucket: canonBucket(it?.bucket ?? nextBucket),
          totalLikes: Math.max(Number(it?.totalLikes || 0), nextTotal),
          likes: Math.max(Number(it?.likes || 0), nextToday),
          hof: !!it?.hof || nextHof
        };
      }));
    }

    // 3) 殿堂入りメモリへ反映
    if (!__hofSnapshotMemory || !Array.isArray(__hofSnapshotMemory.items)) {
      __hofSnapshotMemory = {
        day: todayJSTString(),
        generatedAt: null,
        hofThreshold: Number(state.hofThreshold || 20),
        items: []
      };
    }

    let found = false;

    __hofSnapshotMemory.items = (__hofSnapshotMemory.items || []).map(it => {
      if (!it?.text) return it;
      if (!sameCanonicalMetaphor(it, liked)) return it;

      found = true;
      return {
        ...it,
        mode: canonMode(it?.mode || nextMode),
        bucket: canonBucket(it?.bucket ?? nextBucket),
        totalLikes: Math.max(Number(it?.totalLikes || 0), nextTotal),
        likes: Math.max(Number(it?.likes || 0), nextToday),
        hof: true
      };
    });

    if (!found && nextHof) {
      __hofSnapshotMemory.items.push({
        id: liked?.id ? String(liked.id).trim() : makeGlobalId({
          mode: nextMode,
          bucket: nextBucket,
          text: liked.text,
          source: "live"
        }),
        text: String(liked.text || "").trim(),
        penName: liked?.penName ? String(liked.penName).trim() : null,
        totalLikes: nextTotal,
        likes: nextToday,
        bucket: nextBucket,
        mode: nextMode,
        hof: true,
        source: "live"
      });
    }

    __hofSnapshotMemory.day = todayJSTString();
    __hofSnapshotMemory.hofThreshold = Number(state.hofThreshold || __hofSnapshotMemory.hofThreshold || 20);
    __hofSnapshotMemory.items = mergeDisplayItems(__hofSnapshotMemory.items)
      .sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));

    saveHallDailyCache({
      day: __hofSnapshotMemory.day,
      generatedAt: __hofSnapshotMemory.generatedAt || null,
      hofThreshold: __hofSnapshotMemory.hofThreshold,
      items: __hofSnapshotMemory.items,
      merged: true
    });

    refreshHallSnapshotHtml();
  }catch(e){
    console.warn("syncLikedItemToCaches error", e);
  }
}

async function fetchHallOfFameForRanking(limit = 100){
  const today = todayJSTString();
  const cached = loadHallDailyCache();

  // ✅ すでに「日次スナップショット + API補完済み」なら最優先で使う
  if (
    cached?.day === today &&
    cached?.merged === true &&
    Array.isArray(cached?.items) &&
    cached.items.length > 0
  ) {
    const items = mergeDisplayItems(
      cached.items
        .map(normalizeHallSnapshotItem)
        .filter(Boolean)
        .filter(it => !isNgText(it.text))
    ).sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));

    state.hofThreshold = Number(cached?.hofThreshold || state.hofThreshold || 20);

    return {
      generatedAt: cached?.generatedAt || null,
      hofThreshold: Number(cached?.hofThreshold || state.hofThreshold || 20),
      items: items.slice(0, limit)
    };
  }

  let daily = null;
  try{
    daily = await fetchHallOfFameDaily(limit);
  }catch(e){
    console.warn("fetchHallOfFameDaily failed in fetchHallOfFameForRanking", e?.message || e);
  }

  // ✅ 初回だけ API の真データで両モード補完
  const [triviaRes, funRes] = await Promise.allSettled([
    fetchHallOfFame("trivia", 0, limit),
    fetchHallOfFame("fun", 0, limit)
  ]);

  const apiItems = mergeDisplayItems(
    [
      ...(triviaRes.status === "fulfilled" ? triviaRes.value : []).map(it => ({
        ...it,
        mode: "trivia",
        source: "public",
        hof: true
      })),
      ...(funRes.status === "fulfilled" ? funRes.value : []).map(it => ({
        ...it,
        mode: "fun",
        source: "public",
        hof: true
      }))
    ]
      .map(it => ({
        ...it,
        text: String(it?.text || "").trim(),
        penName: it?.penName ? String(it.penName).trim() : null,
        totalLikes: Number(it?.totalLikes || 0),
        likes: Number(it?.likes || 0),
        bucket: Number.isFinite(Number(it?.bucket)) ? window.bucket10(Number(it.bucket)) : 0
      }))
      .filter(it => it.text)
      .filter(it => !isNgText(it.text))
  ).sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));

  const merged = mergeDisplayItems([
    ...(Array.isArray(daily?.items) ? daily.items : []),
    ...apiItems
  ])
    .filter(it => Number(it.totalLikes || 0) >= Number(state.hofThreshold || daily?.hofThreshold || 20))
    .sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));

  if (!merged.length) {
    throw new Error("hof empty");
  }

  const hofThreshold = Number(
    daily?.hofThreshold ||
    state.hofThreshold ||
    20
  );
  state.hofThreshold = hofThreshold;

  const payload = {
    day: today,
    generatedAt: daily?.generatedAt || null,
    hofThreshold,
    items: merged,
    merged: true
  };
  saveHallDailyCache(payload);

  return {
    generatedAt: payload.generatedAt,
    hofThreshold,
    items: merged.slice(0, limit)
  };
}

// =========================
// ✅ 地点候補
// =========================
async function fetchRegionSuggestions(q){
  const s = String(q || "").trim();
  if (!s) return [];
  const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(s)}`;
  const r = await fetch(url);
  if(!r.ok) throw new Error("地名検索に失敗");
  const j = await r.json();
  const arr = Array.isArray(j) ? j : [];
  return arr.slice(0, 8).map(x => ({
    name: x.properties?.title || x.properties?.address || s,
    lat: Number(x.geometry?.coordinates?.[1]),
    lon: Number(x.geometry?.coordinates?.[0]),
  })).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));
}

async function fetchWeatherByLatLon(lat, lon){
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat);
  url.searchParams.set("longitude", lon);
  url.searchParams.set("daily", "precipitation_probability_max,weathercode");
  url.searchParams.set("timezone", "Asia/Tokyo");
  const r = await fetch(url, { cache: "no-store" });
  if(!r.ok) throw new Error("天気取得に失敗");
  const j = await r.json();
  const p = Number(j?.daily?.precipitation_probability_max?.[0] ?? 0);
  const c = Number(j?.daily?.weathercode?.[0] ?? 0);
  return { precipProb: p, weatherCode: c };
}

// =========================
// ✅ UI helpers
// =========================
function setText(sel, text){
  const el = $(sel);
  if (el) el.textContent = text;
}

function setHtml(sel, html){
  const el = $(sel);
  if (el) el.innerHTML = html;
}

function likeFxPop(btn){
  btn.classList.remove("like-pop");
  void btn.offsetWidth;
  btn.classList.add("like-pop");
}

function likeFxPlusOne(btn){
  const span = document.createElement("span");
  span.className = "like-plusone";
  span.textContent = "+1";
  btn.appendChild(span);
  setTimeout(() => span.remove(), 900);
}

function selectRandom(arr){
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function candidateFromSeed(mode, bucket){
  const map = modeMetaphors(mode);
  const arr = map?.[bucket10(bucket)] || [];
  const text = selectRandom(arr);
  if (!text) return null;
  return {
    id: makeGlobalId({ mode, bucket, text, source: "seed" }),
    text,
    penName: "元ネタ",
    totalLikes: 0,
    likesToday: 0,
    bucket: bucket10(bucket),
    mode,
    source: "seed",
    hof: false
  };
}

async function getCandidates(mode, bucket){
  const publicItems = await fetchPublic(mode, bucket).catch(() => []);
  const merged = mergeDisplayItems([
    ...publicItems,
    ...(candidateFromSeed(mode, bucket) ? [candidateFromSeed(mode, bucket)] : [])
  ]);
  return merged.filter(it => !isNgText(it.text));
}

function pickPhrase(mode, bucket, usedTexts = new Set()){
  return getCandidates(mode, bucket).then(cands => {
    const available = cands.filter(it => !usedTexts.has(normalizeMetaphorText(it.text)));
    return selectRandom(available.length ? available : cands);
  });
}

function renderWeather(){
  setText("#weatherLabel", weatherCodeLabel(state.weatherCode));
  setText("#probLabel", `${bucket10(state.precipProb)}%`);
  setText("#placeLabel", state.pointName || "地点未設定");
}

function renderPhrases(){
  const slots = [
    ["m", "#phraseMorning", "朝 6〜11時"],
    ["d", "#phraseDay", "昼 12〜17時"],
    ["e", "#phraseEvening", "夜 18〜23時"],
  ];

  for (const [slot, sel, title] of slots) {
    const p = state.currentPhrases[slot];
    const html = p ? `
      <div class="phrase-card">
        <div class="phrase-head">${title}</div>
        <div class="phrase-text">${escHtml(p.text)}：${bucket10(state.precipProb)}％</div>
        <div class="phrase-meta">${toModeLabel(p.mode)} / 累計 ${Number(p.totalLikes || 0)} / 今日 ${Number(p.likesToday || 0)}</div>
        <button class="like-btn" id="likeBtn_${slot}">いいね <span id="likeCount_${slot}">${Number(p.likesToday || 0)}</span></button>
      </div>
    ` : `
      <div class="phrase-card">
        <div class="phrase-head">${title}</div>
        <div class="phrase-text">---</div>
      </div>
    `;
    setHtml(sel, html);
    updateLikeUI(slot);
  }
}

function updateLikeUI(slot){
  const phraseObj = state.currentPhrases[slot];
  const btnEl = document.getElementById(`likeBtn_${slot}`);
  const countEl = document.getElementById(`likeCount_${slot}`);
  if (!phraseObj || !btnEl || !countEl) return;

  countEl.textContent = String(Number(phraseObj.likesToday || 0));

  btnEl.onclick = async () => {
    btnEl.disabled = true;
    try{
      const prevToday = Number(state.currentPhrases[slot]?.likesToday || 0);
      const prevTotal = Number(state.currentPhrases[slot]?.totalLikes || 0);

      const out = await likeAny({
        id: phraseObj.id,
        mode: phraseObj.mode || currentMode(),
        bucket: Number(phraseObj.bucket ?? 0),
        text: phraseObj.text,
        penName: normalizePenName(phraseObj.penName),
        source: phraseObj.source || null,
        clientId: getClientId(),
      });

      likeFxPop(btnEl);
      likeFxPlusOne(btnEl);

      // ✅ サーバ値が一時的に低く返っても、画面上では減らさない
      const nextToday = Math.max(Number(out.likesToday || 0), prevToday + 1);
      const nextTotal = Math.max(Number(out.totalLikes || 0), prevTotal + 1);

      state.currentPhrases[slot].likesToday = nextToday;
      state.currentPhrases[slot].totalLikes = nextTotal;
      state.currentPhrases[slot].hof =
        !!out.hof || (nextTotal >= Number(state.hofThreshold || 20));

      updateLikeUI(slot);

      // ✅ publicCache / 殿堂入りメモリ / 殿堂入りHTML を即時同期
      syncLikedItemToCaches({
        id: state.currentPhrases[slot].id,
        text: state.currentPhrases[slot].text,
        penName: state.currentPhrases[slot].penName,
        mode: state.currentPhrases[slot].mode,
        bucket: state.currentPhrases[slot].bucket,
        likesToday: nextToday,
        totalLikes: nextTotal,
        hof: state.currentPhrases[slot].hof,
        source: state.currentPhrases[slot].source
      });

    }catch(e){
      alert(`いいね失敗：${e?.message || e}`);
    }finally{
      btnEl.disabled = false;
    }
  };
}

// =========================
// ✅ ランキング描画
// =========================
async function renderRankings(){
  const token = ++__rankRenderToken;
  const mode = currentMode();
  const bucket = bucket10(state.precipProb ?? 0);

  const latestEl = $("#rankLatest");
  const todayEl  = $("#rankToday");
  const hallWrap = $("#rankHallWrap");

  if (latestEl) latestEl.innerHTML = `<div class="rank-empty">読み込み中...</div>`;
  if (todayEl)  todayEl.innerHTML  = `<div class="rank-empty">読み込み中...</div>`;
  if (hallWrap) hallWrap.innerHTML = `<div class="rank-empty">読み込み中...</div>`;

  const [latestItems, todayItems, hallData] = await Promise.allSettled([
    fetchPublic(mode, bucket),
    fetchRankingToday(mode, bucket, 10),
    fetchHallOfFameForRanking(20)
  ]);

  if (token !== __rankRenderToken) return;

  // 最新
  if (latestEl) {
    const arr = latestItems.status === "fulfilled"
      ? mergeDisplayItems(latestItems.value || [])
          .sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0))
          .slice(0, 10)
      : [];

    latestEl.innerHTML = arr.length
      ? arr.map((it, i) => buildRankingItemHtml(it, i + 1, "total")).join("")
      : `<div class="rank-empty">最新ネタはまだありません</div>`;
  }

  // 今日
  if (todayEl) {
    const arr = todayItems.status === "fulfilled"
      ? mergeDisplayItems(
          (todayItems.value || []).map(it => ({
            ...it,
            mode,
            bucket,
            totalLikes: Number(it.totalLikes || it.likes_total || 0),
            likes: Number(it.likes || it.likesToday || 0)
          }))
        ).slice(0, 10)
      : [];

    todayEl.innerHTML = arr.length
      ? arr.map((it, i) => buildRankingItemHtml(it, i + 1, "today")).join("")
      : `<div class="rank-empty">今日のランキングはまだありません</div>`;
  }

  // 殿堂入り
  if (hallWrap) {
    if (hallData.status === "fulfilled") {
      __hofSnapshotMemory = {
        day: todayJSTString(),
        generatedAt: hallData.value.generatedAt || null,
        hofThreshold: Number(hallData.value.hofThreshold || state.hofThreshold || 20),
        items: hallData.value.items || []
      };
      __hofSnapshotHtml = buildHallCardHtmlFromSnapshot(__hofSnapshotMemory);
      hallWrap.innerHTML = __hofSnapshotHtml;
    } else {
      hallWrap.innerHTML = `
        <section class="rank-card" id="rankHofCard">
          <div class="rank-head">
            <h3>殿堂入り</h3>
            <div class="rank-sub">取得失敗</div>
          </div>
          <div class="rank-body">
            <div class="rank-empty">殿堂入りの取得に失敗しました</div>
          </div>
        </section>
      `;
    }
  }
}

// =========================
// ✅ メイン更新
// =========================
async function refreshAllByPoint(point){
  state.pointName = point.name;
  state.lat = point.lat;
  state.lon = point.lon;

  const w = await fetchWeatherByLatLon(point.lat, point.lon);
  state.precipProb = Number(w.precipProb || 0);
  state.weatherCode = Number(w.weatherCode || 0);

  renderWeather();

  const mode = currentMode();
  const bucket = bucket10(state.precipProb);
  const used = new Set();

  const m = await pickPhrase(mode, bucket, used);
  if (m) used.add(normalizeMetaphorText(m.text));
  const d = await pickPhrase(mode, bucket, used);
  if (d) used.add(normalizeMetaphorText(d.text));
  const e = await pickPhrase(mode, bucket, used);

  state.currentPhrases = { m, d, e };
  renderPhrases();

  await renderRankings();
  await pingUsageOncePerDay("weather_ok");
}

// =========================
// ✅ イベント
// =========================
async function onSearch(){
  const q = String($("#regionInput")?.value || "").trim();
  if (!q) {
    alert("地域名を入力してください");
    return;
  }

  const list = await fetchRegionSuggestions(q);
  const box = $("#suggestions");
  if (!box) return;

  if (!list.length) {
    box.innerHTML = `<div class="suggest-empty">候補が見つかりません</div>`;
    return;
  }

  box.innerHTML = list.map((it, idx) => `
    <button class="suggest-item" data-idx="${idx}">
      ${escHtml(it.name)}
    </button>
  `).join("");

  [...box.querySelectorAll(".suggest-item")].forEach(btn => {
    btn.onclick = async () => {
      const idx = Number(btn.dataset.idx);
      const point = list[idx];
      box.innerHTML = "";
      $("#regionInput").value = point.name;
      await refreshAllByPoint(point);
    };
  });
}

async function onReroll(){
  const mode = currentMode();
  const bucket = bucket10(state.precipProb ?? 0);
  const used = new Set();

  const m = await pickPhrase(mode, bucket, used);
  if (m) used.add(normalizeMetaphorText(m.text));
  const d = await pickPhrase(mode, bucket, used);
  if (d) used.add(normalizeMetaphorText(d.text));
  const e = await pickPhrase(mode, bucket, used);

  state.currentPhrases = { m, d, e };
  renderPhrases();
}

function bindEvents(){
  $("#searchBtn")?.addEventListener("click", onSearch);
  $("#rerollBtn")?.addEventListener("click", onReroll);

  $$('input[name="mode"]').forEach(r => {
    r.addEventListener("change", async () => {
      if (!state.pointName || !Number.isFinite(state.lat) || !Number.isFinite(state.lon)) return;

      const mode = currentMode();
      const bucket = bucket10(state.precipProb ?? 0);
      const used = new Set();

      const m = await pickPhrase(mode, bucket, used);
      if (m) used.add(normalizeMetaphorText(m.text));
      const d = await pickPhrase(mode, bucket, used);
      if (d) used.add(normalizeMetaphorText(d.text));
      const e = await pickPhrase(mode, bucket, used);

      state.currentPhrases = { m, d, e };
      renderPhrases();
      await renderRankings();
    });
  });
}

// =========================
// ✅ 初期化
// =========================
async function init(){
  bindEvents();

  try{
    const health = await apiGet("/api/health");
    console.log("health", health);
  }catch(e){
    console.warn("health failed", e);
  }

  setText("#buildLabel", BUILD);
}

document.addEventListener("DOMContentLoaded", init);

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
function extractHallSnapshotItemsFromPayload(data){
  const a = Array.isArray(data?.items) ? data.items : [];
  const t = Array.isArray(data?.triviaItems) ? data.triviaItems : (Array.isArray(data?.trivia) ? data.trivia : []);
  const f = Array.isArray(data?.funItems) ? data.funItems : (Array.isArray(data?.fun) ? data.fun : []);

  return mergeDisplayItems(
    [
      ...a.map(it => ({
        ...it,
        mode: (it?.mode === "fun" ? "fun" : "trivia"),
        source: "hof_daily"
      })),
      ...t.map(it => ({
        ...it,
        mode: "trivia",
        source: "hof_daily"
      })),
      ...f.map(it => ({
        ...it,
        mode: "fun",
        source: "hof_daily"
      }))
    ]
      .map(normalizeHallSnapshotItem)
      .filter(Boolean)
      .filter(it => !isNgText(it.text))
  ).sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));
}

function hasHallMode(items, mode){
  const m = (mode === "fun" ? "fun" : "trivia");
  return (Array.isArray(items) ? items : []).some(it => (it?.mode === "fun" ? "fun" : "trivia") === m);
}

async function fetchHallModeFromApiOnce(mode, limit = 100){
  const arr = await fetchHallOfFame(mode, 0, limit);

  return mergeDisplayItems(
    (Array.isArray(arr) ? arr : [])
      .map(it => ({
        ...it,
        mode: (mode === "fun" ? "fun" : "trivia"),
        source: "public"
      }))
      .map(normalizeHallSnapshotItem)
      .filter(Boolean)
      .filter(it => !isNgText(it.text))
  ).sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));
}
function saveHallDailyCache(payload){
  try{
    localStorage.setItem(HOF_DAILY_CACHE_KEY, JSON.stringify(payload));
  }catch{}
}
function loadHallDailyCache(){
  try{
    return JSON.parse(localStorage.getItem(HOF_DAILY_CACHE_KEY) || "null");
  }catch{
    return null;
  }
}

async function fetchHallOfFameDaily(limit = 100){
  const today = todayJSTString();
  const cached = loadHallDailyCache();

  if (cached?.day === today && Array.isArray(cached?.items) && cached.items.length > 0) {
    if (cached?.hofThreshold != null) {
      state.hofThreshold = Number(cached.hofThreshold || state.hofThreshold || 20);
    }

    const cachedItems = mergeDisplayItems(
      cached.items
        .map(normalizeHallSnapshotItem)
        .filter(Boolean)
        .filter(it => !isNgText(it.text))
    ).sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));

    return {
      generatedAt: cached?.generatedAt || null,
      hofThreshold: Number(cached?.hofThreshold || state.hofThreshold || 20),
      items: cachedItems.slice(0, limit)
    };
  }

  const url = `${HOF_DAILY_JSON_URL}?day=${encodeURIComponent(today)}&_=${Date.now()}`;

  try{
    const res = await fetch(url, { method:"GET", cache:"no-store" });
    const data = await res.json().catch(()=>null);

    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `hof_daily failed ${res.status}`);
    }

    let items = extractHallSnapshotItemsFromPayload(data);

    const needTrivia = !hasHallMode(items, "trivia");
    const needFun = !hasHallMode(items, "fun");

    if (needTrivia || needFun){
      const [triviaFill, funFill] = await Promise.all([
        needTrivia ? fetchHallModeFromApiOnce("trivia", limit) : Promise.resolve([]),
        needFun ? fetchHallModeFromApiOnce("fun", limit) : Promise.resolve([])
      ]);

      items = mergeDisplayItems([
        ...items,
        ...triviaFill,
        ...funFill
      ]).sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));
    }

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
async function fetchHallOfFameForRanking(limit = 100){
  const today = todayJSTString();
  const cached = loadHallDailyCache();

  if (
    cached?.day === today &&
    cached?.merged === true &&
    Array.isArray(cached?.items) &&
    cached.items.length > 0
  ) {
    const items = mergeDisplayItems(
      cached.items
        .map(normalizeHallSnapshotItem)
        .filter(Boolean)
        .filter(it => !isNgText(it.text))
    ).sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));

    state.hofThreshold = Number(cached?.hofThreshold || state.hofThreshold || 20);

    return {
      generatedAt: cached?.generatedAt || null,
      hofThreshold: Number(cached?.hofThreshold || state.hofThreshold || 20),
      items: items.slice(0, limit)
    };
  }

  let daily = null;
  try{
    daily = await fetchHallOfFameDaily(limit);
  }catch(e){
    console.warn("fetchHallOfFameDaily failed in fetchHallOfFameForRanking", e?.message || e);
  }

  const [triviaRes, funRes] = await Promise.allSettled([
    fetchHallOfFame("trivia", 0, limit),
    fetchHallOfFame("fun", 0, limit)
  ]);

  const apiItems = mergeDisplayItems(
    [
      ...(triviaRes.status === "fulfilled" ? triviaRes.value : []).map(it => ({
        ...it,
        mode: "trivia",
        source: "public",
        hof: true
      })),
      ...(funRes.status === "fulfilled" ? funRes.value : []).map(it => ({
        ...it,
        mode: "fun",
        source: "public",
        hof: true
      }))
    ]
      .map(it => ({
        ...it,
        text: String(it?.text || "").trim(),
        penName: it?.penName ? String(it.penName).trim() : null,
        totalLikes: Number(it?.totalLikes || 0),
        likes: Number(it?.likes || it?.likesToday || 0),
        bucket: Number.isFinite(Number(it?.bucket)) ? window.bucket10(Number(it.bucket)) : 0
      }))
      .filter(it => it.text)
      .filter(it => !isNgText(it.text))
  ).sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));

  const merged = mergeDisplayItems([
    ...(Array.isArray(daily?.items) ? daily.items : []),
    ...apiItems
  ])
    .filter(it => Number(it.totalLikes || 0) >= Number(state.hofThreshold || daily?.hofThreshold || 20))
    .sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));

  if (!merged.length) {
    throw new Error("hof empty");
  }

  const hofThreshold = Number(
    daily?.hofThreshold ||
    state.hofThreshold ||
    20
  );
  state.hofThreshold = hofThreshold;

  const payload = {
    day: today,
    generatedAt: daily?.generatedAt || null,
    hofThreshold,
    items: merged,
    merged: true
  };
  saveHallDailyCache(payload);

  return {
    generatedAt: payload.generatedAt,
    hofThreshold,
    items: merged.slice(0, limit)
  };
}
function buildHallCardHtmlFromSnapshot(hofData){
  const hofTh = Number(hofData?.hofThreshold || state.hofThreshold || 20);
  const generatedAt = hofData?.generatedAt ? String(hofData.generatedAt) : null;

  const snapItems = Array.isArray(hofData?.items) ? hofData.items : [];
  const mergedItems = mergeDisplayItems(snapItems)
    .filter(it => Number(it.totalLikes || 0) >= hofTh)
    .sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));

  const rows = mergedItems.length
    ? mergedItems.slice(0, 20).map((it, idx) => {
        const modeLabel = it.mode === "fun" ? "お笑い" : "雑学";
        const pen = it.penName ? ` / ${escHtml(it.penName)}` : "";
        const bucket = Number.isFinite(Number(it.bucket)) ? ` / ${window.bucket10(Number(it.bucket))}%` : "";
        const badge = Number(it.totalLikes || 0) >= hofTh
          ? ` <span class="hof-badge">殿堂入り</span>`
          : "";
        return `
          <div class="rank-item">
            <div class="rank-no">${idx + 1}</div>
            <div class="rank-main">
              <div class="rank-text">${escHtml(it.text)}${badge}</div>
              <div class="rank-meta">${modeLabel}${bucket}${pen} / 累計👍${Number(it.totalLikes || 0)}</div>
            </div>
          </div>
        `;
      }).join("")
    : `<div class="rank-empty">殿堂入りはまだありません</div>`;

  const snapshotNote = generatedAt
    ? `<div class="rank-note">日次スナップショット: ${escHtml(generatedAt)}</div>`
    : `<div class="rank-note">日次スナップショット: 取得時刻なし</div>`;

  return `
    <div class="rank-card" id="rankHofCard">
      <div class="rank-title">👑 殿堂入り（全モード共通 / 累計👍${hofTh}以上）</div>
      ${snapshotNote}
      <div>${rows}</div>
    </div>
  `;
}

function canonMode(mode){
  return (mode === "fun") ? "fun" : "trivia";
}

function canonBucket(bucket){
  return Number.isFinite(Number(bucket)) ? window.bucket10(Number(bucket)) : 0;
}

function sameCanonicalMetaphor(a, b){
  const am = canonMode(a?.mode);
  const bm = canonMode(b?.mode);
  if (am !== bm) return false;

  const at = normalizeMetaphorText(a?.text || "");
  const bt = normalizeMetaphorText(b?.text || "");
  return !!at && at === bt;
}

function refreshHallSnapshotHtml(){
  try{
    const base = (__hofSnapshotMemory && Array.isArray(__hofSnapshotMemory.items))
      ? __hofSnapshotMemory
      : {
          day: todayJSTString(),
          generatedAt: null,
          hofThreshold: Number(state.hofThreshold || 20),
          items: []
        };

    base.hofThreshold = Number(state.hofThreshold || base.hofThreshold || 20);
    __hofSnapshotHtml = buildHallCardHtmlFromSnapshot(base);

    const el = document.getElementById("rankHofCard");
    if (el && __hofSnapshotHtml) {
      el.outerHTML = __hofSnapshotHtml;
    }
  }catch(e){
    console.warn("refreshHallSnapshotHtml error", e);
  }
}

function syncLikedItemToCaches(liked){
  try{
    if (!liked?.text) return;

    const nextMode  = canonMode(liked.mode);
    const nextBucket = canonBucket(liked.bucket);
    const nextToday = Number(liked.likesToday || 0);
    const nextTotal = Number(liked.totalLikes || 0);
    const nextHof   = !!liked.hof || (nextTotal >= Number(state.hofThreshold || 20));

    for (const slot of ["m", "d", "e"]) {
      const cur = state.currentPhrases?.[slot];
      if (!cur?.text) continue;
      if (!sameCanonicalMetaphor(cur, liked)) continue;

      state.currentPhrases[slot] = {
        ...cur,
        mode: nextMode,
        bucket: canonBucket(cur.bucket ?? nextBucket),
        likesToday: Math.max(Number(cur.likesToday || 0), nextToday),
        totalLikes: Math.max(Number(cur.totalLikes || 0), nextTotal),
        hof: !!cur.hof || nextHof
      };
    }

    for (const [k, arr] of publicCache.entries()) {
      if (!Array.isArray(arr)) continue;

      publicCache.set(k, arr.map(it => {
        if (!it?.text) return it;
        const candidate = { ...it, mode: it?.mode || nextMode };
        if (!sameCanonicalMetaphor(candidate, liked)) return it;

        return {
          ...it,
          mode: canonMode(it?.mode || nextMode),
          bucket: canonBucket(it?.bucket ?? nextBucket),
          totalLikes: Math.max(Number(it?.totalLikes || 0), nextTotal),
          likes: Math.max(Number(it?.likes || it?.likesToday || 0), nextToday),
          likesToday: Math.max(Number(it?.likesToday || it?.likes || 0), nextToday),
          hof: !!it?.hof || nextHof
        };
      }));
    }

    if (!__hofSnapshotMemory || !Array.isArray(__hofSnapshotMemory.items)) {
      __hofSnapshotMemory = {
        day: todayJSTString(),
        generatedAt: null,
        hofThreshold: Number(state.hofThreshold || 20),
        items: []
      };
    }

    let found = false;

    __hofSnapshotMemory.items = (__hofSnapshotMemory.items || []).map(it => {
      if (!it?.text) return it;
      if (!sameCanonicalMetaphor(it, liked)) return it;

      found = true;
      return {
        ...it,
        mode: canonMode(it?.mode || nextMode),
        bucket: canonBucket(it?.bucket ?? nextBucket),
        totalLikes: Math.max(Number(it?.totalLikes || 0), nextTotal),
        likes: Math.max(Number(it?.likes || it?.likesToday || 0), nextToday),
        likesToday: Math.max(Number(it?.likesToday || it?.likes || 0), nextToday),
        hof: true
      };
    });

    if (!found && nextHof) {
      __hofSnapshotMemory.items.push({
        id: liked?.id ? String(liked.id).trim() : makeGlobalId({
          mode: nextMode,
          bucket: nextBucket,
          text: liked.text,
          source: "live"
        }),
        text: String(liked.text || "").trim(),
        penName: liked?.penName ? String(liked.penName).trim() : null,
        totalLikes: nextTotal,
        likes: nextToday,
        likesToday: nextToday,
        bucket: nextBucket,
        mode: nextMode,
        hof: true,
        source: "live"
      });
    }

    __hofSnapshotMemory.day = todayJSTString();
    __hofSnapshotMemory.hofThreshold = Number(state.hofThreshold || __hofSnapshotMemory.hofThreshold || 20);
    __hofSnapshotMemory.items = mergeDisplayItems(__hofSnapshotMemory.items)
      .sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));

    saveHallDailyCache({
      day: __hofSnapshotMemory.day,
      generatedAt: __hofSnapshotMemory.generatedAt || null,
      hofThreshold: __hofSnapshotMemory.hofThreshold,
      items: __hofSnapshotMemory.items,
      merged: true
    });

    refreshHallSnapshotHtml();
  }catch(e){
    console.warn("syncLikedItemToCaches error", e);
  }
}
    
async function ensureHallSnapshotLoaded(){
  const today = todayJSTString();

  if (__hofSnapshotMemory?.day === today && Array.isArray(__hofSnapshotMemory.items)) {
    return __hofSnapshotMemory;
  }

  const hofData = await fetchHallOfFameForRanking(100);
  __hofSnapshotMemory = {
    day: today,
    generatedAt: hofData?.generatedAt || null,
    hofThreshold: Number(hofData?.hofThreshold || state.hofThreshold || 20),
    items: Array.isArray(hofData?.items) ? hofData.items : []
  };
  __hofSnapshotHtml = buildHallCardHtmlFromSnapshot(__hofSnapshotMemory);
  return __hofSnapshotMemory;
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
function buildHallCanonicalTop20(){
  const hofTh = Number(state.hofThreshold || 20);
  const all = [];

  for (const mode of ["trivia", "fun"]) {
    for (let b = 0; b <= 100; b += 10) {
      const pool = buildCandidatePool(mode, b);
      for (const it of pool) {
        if (!it?.text) continue;
        all.push({
          id: it.id || makeGlobalId({ mode, bucket: b, text: it.text, source: it.source || "base" }),
          text: String(it.text || "").trim(),
          penName: it.penName || null,
          totalLikes: Number(it.totalLikes || 0),
          likes: Number(it.likes || 0),
          bucket: b,
          mode,
          hof: !!it.hof || (Number(it.totalLikes || 0) >= hofTh),
          source: it.source || "base"
        });
      }
    }
  }

  return mergeDisplayItems(all)
    .filter(it => Number(it.totalLikes || 0) >= hofTh)
    .sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0))
    .slice(0, 20);
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
      likes: Number(item.likes || 0),
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
      const prevToday = Number(state.currentPhrases[slot]?.likesToday || 0);
      const prevTotal = Number(state.currentPhrases[slot]?.totalLikes || 0);

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

      const nextToday = Math.max(Number(out.likesToday || 0), prevToday + 1);
      const nextTotal = Math.max(Number(out.totalLikes || 0), prevTotal + 1);

      state.currentPhrases[slot].likesToday = nextToday;
      state.currentPhrases[slot].totalLikes = nextTotal;
      state.currentPhrases[slot].hof =
        !!out.hof || (nextTotal >= Number(state.hofThreshold || 20));

      syncLikedItemToCaches({
        id: state.currentPhrases[slot].id,
        text: state.currentPhrases[slot].text,
        penName: state.currentPhrases[slot].penName,
        mode: state.currentPhrases[slot].mode,
        bucket: state.currentPhrases[slot].bucket,
        likesToday: nextToday,
        totalLikes: nextTotal,
        hof: state.currentPhrases[slot].hof,
        source: state.currentPhrases[slot].source
      });

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
  });

  if (metaAll) metaAll.textContent = "地点を選んでください";
}

// =========================
// render（メイン）
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

      state.currentPhrases[slotKey] = {
        text: null, source: null, id: null, penName: null,
        likesToday: 0, totalLikes: 0, hof: false, mode: null, bucket: null, dedupeKey: null
      };
      updateLikeUI(slotKey);
      updateDeleteUI(slotKey);
      return null;
    }

    const rounded = window.bucket10(value);
    if (popEl) popEl.textContent = `${rounded}%`;
    setIcon(slotKey, rounded);

    const mode = getSelectedMode();
    let picked;

    const prev = state.currentPhrases[slotKey] || {};
    const sameContext =
      !!prev.text &&
      prev.mode === mode &&
      Number(prev.bucket) === Number(rounded) &&
      !isNgText(prev.text);

    if (!window.__forceRepick && sameContext) {
      picked = prev;
    } else if (__freezeMetaphor && prev?.text) {
      picked = prev;
    } else {
      picked = pickMetaphor(mode, rounded);
    }

    for (let i = 0; i < 5 && picked?.text && isNgText(picked.text); i++) {
      picked = pickMetaphor(mode, rounded);
    }

    if (picked?.text && isNgText(picked.text)) {
      picked = {
        text: "（非表示ワードが含まれるため表示できません）",
        source: null,
        id: null,
        penName: null,
        totalLikes: 0,
        hof: false,
        bucket: rounded,
        mode,
        dedupeKey: null
      };
    }

    try {
      const mbKey = keyMB(mode, rounded);
      const pubArr = publicCache.get(mbKey);

      if (Array.isArray(pubArr) && pubArr.length && picked?.text) {
        const canon = normalizeMetaphorText(picked.text);
        const hit = pubArr.find(it => normalizeMetaphorText(it?.text || "") === canon);

        if (hit) {
          picked = {
            ...picked,
            source: "public",
            id: String(hit.id || picked.id || "").trim() || null,
            penName: (hit.penName != null ? String(hit.penName).trim() : picked.penName),
            totalLikes: Number(hit.totalLikes || 0),
            hof: !!hit.hof,
            dedupeKey: makeMetaphorDedupeKey({ mode, bucket: rounded, text: hit.text || picked.text })
          };
        }
      }
    } catch (e) {
      console.warn("public upgrade failed", e);
    }

    const displayPen = (picked.penName && String(picked.penName).trim())
      ? String(picked.penName).trim()
      : "匿名";

    const totalLikesPicked = Number(picked.totalLikes || 0);
    const hofPicked = !!picked.hof || (totalLikesPicked >= Number(state.hofThreshold || 20));

    if (metaEl) {
      const penHtml = penHtmlIfAny(displayPen);
      const hofHtml = hofPicked ? ` <span class="hof-badge">👑殿堂入り</span>` : "";
      metaEl.innerHTML =
        `${escapeHtml(label)}：${escapeHtml(picked.text)}${penHtml}${hofHtml}` +
        ` <span class="muted" style="font-size:12px;">[src:${escapeHtml(picked.source || "base")} b:${rounded}]</span>`;
    }

    const prevId = state.currentPhrases[slotKey]?.id || null;
    const nextId = picked.id || null;

    const nextLikesToday = (prevId && nextId && prevId === nextId)
      ? Number(state.currentPhrases[slotKey]?.likesToday || 0)
      : 0;

    const nextTotalLikes = (prevId && nextId && prevId === nextId)
      ? Number(state.currentPhrases[slotKey]?.totalLikes || totalLikesPicked || 0)
      : Number(totalLikesPicked || 0);

    state.currentPhrases[slotKey] = {
      text: picked.text,
      source: picked.source || null,
      id: nextId,
      penName: displayPen,
      likesToday: nextLikesToday,
      totalLikes: nextTotalLikes,
      hof: hofPicked,
      mode,
      bucket: rounded,
      dedupeKey: picked.dedupeKey || makeMetaphorDedupeKey({ mode, bucket: rounded, text: picked.text || "" })
    };

    updateLikeUI(slotKey);
    updateDeleteUI(slotKey);

    try { applyTheme(rounded); } catch {}

    return { slotKey, value: rounded, text: picked.text, label };
  };

  if (!state.pops) {
    if (hintEl) hintEl.textContent = "地点を選ぶと自動取得します";
    renderEmpty();
    if (footEl) footEl.textContent = "";
    try { ensureMySubmissionsDom(); } catch {}
    try { renderMySubmissions(); } catch (e) { console.warn("renderMySubmissions error", e); }
    return;
  }

  if (hintEl) hintEl.textContent = state.placeLabel ? `地点：${state.placeLabel}` : "地点：--";

  const a = setSlot("m", state.pops.m, "朝");
  const b = setSlot("d", state.pops.d, "昼");
  const c = setSlot("e", state.pops.e, "夜");

  const candidates = [a, b, c].filter(Boolean);
  if (!candidates.length) {
    if (metaAll) metaAll.textContent = "データが取得できませんでした（別地点で試してください）";
    if (footEl) footEl.textContent = "";
    return;
  }

  const maxOne = candidates.reduce((x, y) => (y.value > x.value ? y : x));
  if (metaAll) {
    const p = state.currentPhrases?.[maxOne.slotKey] || {};
    const src = p.source || "base";
    const bkt = Number(p.bucket ?? maxOne.value);

    metaAll.innerHTML =
      `今日いちばん怪しいのは【${escapeHtml(maxOne.label)}】：${escapeHtml(String(maxOne.value))}% → ${escapeHtml(String(maxOne.text))}` +
      ` <span class="muted" style="font-size:12px;">[src:${escapeHtml(src)} b:${escapeHtml(String(bkt))}]</span>`;
  }

  if (footEl) {
    footEl.textContent = "※降水確率を0/10/…/100%に丸め、公開ネタ（public/base/json）からランダム表示";
  }
}

// =========================
// API: geocode
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

// ✅（内部）天気取得本体
async function fetchPopsBySlotsNetwork(lat, lon, timeoutMs = 4500) {
  const url = new URL(FC);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("hourly", "precipitation_probability");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "2");

  const res = await fetchWithTimeout(url.toString(), timeoutMs);
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

// ✅（表）SWR（キャッシュ即表示→裏で更新）
async function fetchPopsBySlotsSWR(lat, lon, { onCached, timeoutMs = 4500 } = {}) {
  const key = wxKey(lat, lon);
  const cache = loadWxCache();
  const hit = cache?.[key];

  const now = Date.now();
  const isFresh = hit && hit.ts && (now - hit.ts) < WX_CACHE_TTL_MS;

  if (hit?.pops && typeof onCached === "function") {
    onCached({ pops: hit.pops, tz: hit.tz || null, cached: true, fresh: !!isFresh });
  }

  const out = await fetchPopsBySlotsNetwork(lat, lon, timeoutMs);
  cache[key] = { ts: Date.now(), pops: out.pops, tz: out.tz || null };
  saveWxCache(cache);

  return out;
}

// =========================
// ✅ ランキングDOM
// =========================
function ensureRankingDom(){
  let wrap = document.getElementById("todayRankingWrap");
  if (!wrap) {
    const refreshBtn = document.getElementById("refresh");
    if (!refreshBtn) return;

    wrap = document.createElement("div");
    wrap.id = "todayRankingWrap";
    wrap.style.marginTop = "14px";
    wrap.innerHTML = `
      <div id="rankStatus">更新中…</div>
      <div class="rankBody" id="rankBody"></div>
    `;
    refreshBtn.insertAdjacentElement("afterend", wrap);
  }

  if (!document.getElementById("rankStatus")) {
    const st = document.createElement("div");
    st.id = "rankStatus";
    st.textContent = "更新中…";
    wrap.prepend(st);
  }
  if (!document.getElementById("rankBody")) {
    const body = document.createElement("div");
    body.className = "rankBody";
    body.id = "rankBody";
    wrap.appendChild(body);
  }
}

// =========================
// ✅ 最新枠（折り畳み）の開閉状態を保存
// =========================
const LATEST_OPEN_KEY = "latest_open_v1";
function loadLatestOpen(){
  try { return localStorage.getItem(LATEST_OPEN_KEY) === "1"; } catch { return false; }
}
function saveLatestOpen(open){
  try { localStorage.setItem(LATEST_OPEN_KEY, open ? "1" : "0"); } catch {}
}

// =========================
// ✅ ランキング固定（検索成功 or モード変更 のときだけ更新）
// =========================
let __rankingRenderedKey = null;

function makeRankingKey({ mode, bucket, lat, lon }){
  const mv = String(mode || "").trim();
  const m = (mv === "fun" || mv === "お笑い") ? "fun" : "trivia";
  const b = (bucket == null) ? "null" : String(window.bucket10(bucket));
  const la = (lat == null) ? "null" : String(Math.round(Number(lat) * 10000) / 10000);
  const lo = (lon == null) ? "null" : String(Math.round(Number(lon) * 10000) / 10000);
  return `${m}|${b}|${la},${lo}`;
}

function invalidateRanking(){
  __rankingRenderedKey = null;
}

function getRankingKeyNow(){
  const mode = getSelectedMode();
  const bucket = getCurrentMainBucket();
  const lat = state.selectedLat;
  const lon = state.selectedLon;
  if (bucket == null || lat == null || lon == null) return null;
  return makeRankingKey({ mode, bucket, lat, lon });
}

async function renderRankingOnce(key){
  if (!key) return;
  if (__rankingRenderedKey === key) return;
  __rankingRenderedKey = key;
  await renderRanking();
}

// =========================
// ランキング表示（中身）
// ✅ 表示は「最新（折り畳み）＋今日の総合TOP3＋殿堂入り」だけ
// ✅ FIX: 古いレスポンスで上書きしない
// ✅ FIX: 更新中でも今の内容は消さない
// ✅ SPEED: 段階表示
// =========================
async function renderRanking(){
  try{
    ensureRankingDom();
    const wrap = document.getElementById("todayRankingWrap");
    const rankBody = document.getElementById("rankBody");
    if (!wrap || !rankBody) return;

    const reqId = ++__rankingReqSeq;
    setRankingBusy(true);

    const mode = getSelectedMode();
    const hofTh = Number(state.hofThreshold || 20);
    const latestOpen = loadLatestOpen();

    rankBody.innerHTML = `
      <div id="rankLatestCard" class="card" style="margin:0 0 10px 0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
        <div class="muted">最新の公開ネタを読み込み中…</div>
      </div>

      <div id="rankTodayCard" class="card" style="margin:0 0 10px 0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
        <div class="muted">今日のランキングを読み込み中…</div>
      </div>

      <div id="rankHofCard" class="card" style="margin:0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
        <div class="muted">殿堂入りを読み込み中…</div>
      </div>
    `;

    const latestPromise = (async () => {
      try{
        const latestRaw = (await fetchPublicLatest(mode, 10)).filter(it => !isNgText(it?.text));
        const items = mergeDisplayItems(latestRaw, { mode });

        if (!items.length) {
          return `
            <div id="rankLatestCard" class="card" style="margin:0 0 10px 0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
              <details class="latest-details" id="latestDetails" ${latestOpen ? "open" : ""} style="margin:0;">
                <summary style="display:flex; align-items:center; justify-content:space-between;">
                  <span>最新の公開ネタ（折り畳み） / ${mode==="fun"?"お笑い":"雑学"}</span>
                  <span class="muted" style="font-size:12px;">（開くと10件）</span>
                </summary>
                <div class="muted" style="margin-top:10px;">最新の公開ネタがまだありません</div>
              </details>
            </div>
          `;
        }

        const rows = items.slice(0, 10).map((it, idx) => {
          const pen = penHtmlIfAny(it.penName);
          const bkt = Number(it.bucket ?? 0);
          const bktTag = Number.isFinite(bkt) ? ` <span class="muted" style="font-size:12px;">[${bkt}%]</span>` : "";
          return `
            <div style="padding:10px 0; border-top:1px solid rgba(15,23,42,0.10);">
              <div style="font-weight:800;">${idx+1}. ${escapeHtml(it.text)}${pen}${bktTag}</div>
            </div>
          `;
        }).join("");

        return `
          <div id="rankLatestCard" class="card" style="margin:0 0 10px 0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
            <details class="latest-details" id="latestDetails" ${latestOpen ? "open" : ""} style="margin:0;">
              <summary style="display:flex; align-items:center; justify-content:space-between;">
                <span>最新の公開ネタ（折り畳み） / ${mode==="fun"?"お笑い":"雑学"}</span>
                <span class="muted" style="font-size:12px;">（開くと10件）</span>
              </summary>
              <div style="margin-top:10px;">${rows}</div>
            </details>
          </div>
        `;
      } catch (e) {
        return `
          <div id="rankLatestCard" class="card" style="margin:0 0 10px 0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
            <details class="latest-details" id="latestDetails" ${latestOpen ? "open" : ""} style="margin:0;">
              <summary style="display:flex; align-items:center; justify-content:space-between;">
                <span>最新の公開ネタ（折り畳み） / ${mode==="fun"?"お笑い":"雑学"}</span>
                <span class="muted" style="font-size:12px;">（開くと10件）</span>
              </summary>
              <div class="muted" style="margin-top:10px;">最新の取得に失敗：${escapeHtml(String(e?.message || e))}</div>
            </details>
          </div>
        `;
      }
    })();

    const todayPromise = (async () => {
      try{
        const rankingRaw = (await fetchRankingTodayAll(mode, 20))
          .map(it => ({
            ...it,
            mode,
            bucket: Number.isFinite(Number(it?.bucket)) ? Number(it.bucket) : 0,
            text: String(it?.text || "").trim(),
            penName: it?.penName ? String(it.penName).trim() : null,
            likes: Number(it?.likes || 0),
            source: "public"
          }))
          .filter(it => it.text)
          .filter(it => !isNgText(it?.text));

        const items = mergeDisplayItems(rankingRaw, { mode })
          .sort((a, b) => Number(b.likes || 0) - Number(a.likes || 0))
          .slice(0, 3);

        if (!items.length) {
          return `
            <div id="rankTodayCard" class="card" style="margin:0 0 10px 0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
              <div style="font-weight:900; font-size:16px; margin-bottom:6px;">今日のランキング TOP3（全バケット共通 / ${mode==="fun"?"お笑い":"雑学"}）</div>
              <div class="muted" style="margin-bottom:8px;">※今日(JST)のいいね数で集計（0〜100%まとめて）</div>
              <div class="muted">まだランキングがありません（今日の👍が0件）</div>
            </div>
          `;
        }

        const rows = items.map((it, idx) => {
          const pen = penHtmlIfAny(it.penName);
          return `
            <div style="padding:10px 0; border-top:1px solid rgba(15,23,42,0.10);">
              <div style="font-weight:800;">${idx+1}位：${escapeHtml(it.text)}${pen}${modeBadgeHtml(mode)}</div>
              <div class="muted">今日の👍：${Number(it.likes||0)}</div>
            </div>
          `;
        }).join("");

        return `
          <div id="rankTodayCard" class="card" style="margin:0 0 10px 0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
            <div style="font-weight:900; font-size:16px; margin-bottom:6px;">今日のランキング TOP3（全バケット共通 / ${mode==="fun"?"お笑い":"雑学"}）</div>
            <div class="muted" style="margin-bottom:8px;">※今日(JST)のいいね数で集計（0〜100%まとめて）</div>
            <div>${rows}</div>
          </div>
        `;
      } catch (e) {
        return `
          <div id="rankTodayCard" class="card" style="margin:0 0 10px 0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
            <div style="font-weight:900; font-size:16px; margin-bottom:6px;">今日のランキング TOP3（全バケット共通 / ${mode==="fun"?"お笑い":"雑学"}）</div>
            <div class="muted" style="margin-bottom:8px;">※今日(JST)のいいね数で集計（0〜100%まとめて）</div>
                        <div class="muted">取得失敗：${escapeHtml(String(e?.message || e))}</div>
          </div>
        `;
      }
    })();

    const hofPromise = (async () => {
      try{
        const hall = await ensureHallSnapshotLoaded();
        return buildHallCardHtmlFromSnapshot(hall);
      } catch (e) {
        const fallbackItems = buildHallCanonicalTop20();
        if (fallbackItems.length) {
          const fallback = {
            day: todayJSTString(),
            generatedAt: null,
            hofThreshold: hofTh,
            items: fallbackItems
          };
          __hofSnapshotMemory = fallback;
          __hofSnapshotHtml = buildHallCardHtmlFromSnapshot(fallback);
          return __hofSnapshotHtml;
        }

        return `
          <div id="rankHofCard" class="card" style="margin:0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
            <div style="font-weight:900; font-size:16px; margin-bottom:6px;">👑 殿堂入り（全モード共通 / 累計👍${hofTh}以上）</div>
            <div class="muted">取得失敗：${escapeHtml(String(e?.message || e))}</div>
          </div>
        `;
      }
    })();

    const latestHtml = await latestPromise;
    if (reqId !== __rankingReqSeq) return;
    const latestCard = document.getElementById("rankLatestCard");
    if (latestCard) latestCard.outerHTML = latestHtml;

    const latestDetails = document.getElementById("latestDetails");
    if (latestDetails) {
      latestDetails.addEventListener("toggle", () => {
        saveLatestOpen(!!latestDetails.open);
      }, { passive: true });
    }

    const todayHtml = await todayPromise;
    if (reqId !== __rankingReqSeq) return;
    const todayCard = document.getElementById("rankTodayCard");
    if (todayCard) todayCard.outerHTML = todayHtml;

    const hofHtml = await hofPromise;
    if (reqId !== __rankingReqSeq) return;
    const hofCard = document.getElementById("rankHofCard");
    if (hofCard) hofCard.outerHTML = hofHtml;
    __hofSnapshotHtml = hofHtml;

  } catch (e) {
    const rankBody = document.getElementById("rankBody");
    if (rankBody) {
      rankBody.innerHTML = `<div class="muted">ランキング取得失敗：${escapeHtml(String(e?.message || e))}</div>`;
    }
  } finally {
    setRankingBusy(false);
  }
}

// =========================
// ✅ ランキングAPI
// =========================
let __rankingReqSeq = 0;

function setRankingBusy(busy){
  const st = document.getElementById("rankStatus");
  if (!st) return;
  st.textContent = busy ? "ランキング更新中…" : "ランキング更新完了";
}

async function fetchRankingTodayAll(mode, limit = 20){
  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("limit", String(limit));

  const res = await fetch(`${API_BASE}/api/ranking/today?${params.toString()}`, {
    method:"GET",
    cache:"no-store"
  });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `ranking today failed ${res.status}`);
  return Array.isArray(data.items) ? data.items : [];
}

async function fetchPublicLatest(mode, limit = 10){
  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("limit", String(limit));

  const res = await fetch(`${API_BASE}/api/public_latest?${params.toString()}`, {
    method:"GET",
    cache:"no-store"
  });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `public_latest failed ${res.status}`);
  return Array.isArray(data.items) ? data.items : [];
}

async function fetchPublicMetaphors({ mode, bucket, limit = 80 }){
  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("bucket", String(window.bucket10(bucket)));
  params.set("limit", String(limit));

  const res = await fetch(`${API_BASE}/api/public?${params.toString()}`, {
    method:"GET",
    cache:"no-store"
  });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `public failed ${res.status}`);

  const arr = Array.isArray(data.items) ? data.items : [];
  return arr.map(it => ({
    id: String(it?.id || "").trim(),
    text: String(it?.text || "").trim(),
    penName: it?.penName ? String(it.penName).trim() : null,
    totalLikes: Number(it?.totalLikes || 0),
    likes: Number(it?.likes || 0),
    bucket: Number.isFinite(Number(it?.bucket)) ? window.bucket10(Number(it.bucket)) : window.bucket10(bucket),
    mode: (it?.mode === "fun" ? "fun" : "trivia"),
    hof: !!it?.hof,
    source: "public"
  })).filter(it => it.text);
}

// =========================
// 文字ユーティリティ
// =========================
function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function penHtmlIfAny(name){
  const s = String(name || "").trim();
  if (!s || s === "匿名" || s === "元ネタ") return "";
  return ` <span class="muted">(${escapeHtml(s)})</span>`;
}

function modeBadgeHtml(mode){
  return mode === "fun"
    ? ` <span class="muted">[お笑い]</span>`
    : ` <span class="muted">[雑学]</span>`;
}

function normalizeTextForCompare(s){
  return String(s || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMetaphorText(s){
  return normalizeTextForCompare(s)
    .replace(/[：:]\s*\d+\s*[%％]\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function makeMetaphorDedupeKey({ mode, bucket, text }){
  const m = (mode === "fun" ? "fun" : "trivia");
  const b = Number.isFinite(Number(bucket)) ? window.bucket10(Number(bucket)) : 0;
  const t = normalizeMetaphorText(text);
  return `${m}|${b}|${t}`;
}

function extractEmbeddedPercents(text){
  const t = String(text || "").normalize("NFKC");
  const out = [];
  const re = /(\d{1,3})\s*[%％]/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 100) out.push(n);
  }
  return out;
}

function hasMismatchedPercent(text, bucket){
  const nums = extractEmbeddedPercents(text);
  if (!nums.length) return false;
  const b = window.bucket10(bucket);
  return !nums.some(n => window.bucket10(n) === b);
}

function hasHard100PercentMismatch(text, bucket){
  const nums = extractEmbeddedPercents(text);
  const b = window.bucket10(bucket);
  if (b === 100) return false;
  return nums.includes(100);
}

function isNgText(text){
  const t = String(text || "").normalize("NFKC").trim();
  if (!t) return true;

  const ngWords = [
    "共通テスト"
  ];

  return ngWords.some(w => t.includes(w));
}

function normalizePenName(name){
  const s = String(name || "").normalize("NFKC").trim();
  return s || "匿名";
}

// =========================
// ✅ 重複統合
// =========================
function canonicalId(mode, text){
  const m = (mode === "fun" ? "fun" : "trivia");
  return `cid_${fnv1a32(`${m}|${normalizeMetaphorText(text)}`)}`;
}

function isSeedLike(item){
  const id = String(item?.id || "");
  const source = String(item?.source || "").toLowerCase();
  const penName = String(item?.penName || "");
  return (
    id.startsWith("seedjs_") ||
    source === "seed" ||
    source === "base" ||
    source === "json" ||
    penName.includes("元ネタ")
  );
}

function mergeDisplayItems(items, fallback = {}){
  const map = new Map();

  for (const raw of (Array.isArray(items) ? items : [])) {
    const text = String(raw?.text || "").trim();
    if (!text) continue;
    if (isNgText(text)) continue;

    const mode = (raw?.mode === "fun" ? "fun" : (fallback?.mode === "fun" ? "fun" : "trivia"));
    const bucket = Number.isFinite(Number(raw?.bucket))
      ? window.bucket10(Number(raw.bucket))
      : Number.isFinite(Number(fallback?.bucket))
        ? window.bucket10(Number(fallback.bucket))
        : 0;

    if (hasHard100PercentMismatch(text, bucket)) continue;
    if (hasMismatchedPercent(text, bucket)) continue;

    const cid = canonicalId(mode, text);
    const prev = map.get(cid);

    const next = {
      id: String(raw?.id || "").trim() || makeGlobalId({
        mode,
        bucket,
        text,
        source: raw?.source || "base"
      }),
      text,
      penName: raw?.penName ? String(raw.penName).trim() : null,
      totalLikes: Number(raw?.totalLikes || 0),
      likes: Number(raw?.likes || raw?.likesToday || 0),
      likesToday: Number(raw?.likesToday || raw?.likes || 0),
      bucket,
      mode,
      hof: !!raw?.hof,
      source: raw?.source || "base",
      canonicalId: cid,
      seedLike: isSeedLike(raw),
      dedupeKey: makeMetaphorDedupeKey({ mode, bucket, text })
    };

    if (!prev) {
      map.set(cid, next);
      continue;
    }

    const preferNextIdentity = prev.seedLike && !next.seedLike;

    map.set(cid, {
      ...prev,
      ...next,
      id: preferNextIdentity ? next.id : prev.id,
      penName: prev.penName || next.penName || null,
      totalLikes: Math.max(Number(prev.totalLikes || 0), Number(next.totalLikes || 0)),
      likes: Math.max(Number(prev.likes || 0), Number(next.likes || 0)),
      likesToday: Math.max(Number(prev.likesToday || 0), Number(next.likesToday || 0)),
      hof: !!prev.hof || !!next.hof || Math.max(Number(prev.totalLikes || 0), Number(next.totalLikes || 0)) >= Number(state.hofThreshold || 20),
      source: preferNextIdentity ? next.source : prev.source,
      seedLike: prev.seedLike && next.seedLike,
      canonicalId: cid,
      dedupeKey: prev.dedupeKey || next.dedupeKey || makeMetaphorDedupeKey({ mode, bucket, text })
    });
  }

  return [...map.values()];
}

// =========================
// 検索候補UI
// =========================
function showPlaceSuggestions(results) {
  const box = document.getElementById("suggestions");
  if (!box) return;

  if (!results || !results.length) {
    box.innerHTML = "";
    box.style.display = "none";
    return;
  }

  box.innerHTML = results.map((r, idx) => `
    <button type="button" class="suggItem" data-idx="${idx}">
      ${escapeHtml(r.name)}
    </button>
  `).join("");

  box.style.display = "block";

  [...box.querySelectorAll(".suggItem")].forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.idx);
      const picked = results[idx];
      if (!picked) return;

      const place = document.getElementById("place");
      if (place) place.value = picked.name;

      box.innerHTML = "";
      box.style.display = "none";

      await applyPickedPlace(picked);
    });
  });
}

async function applyPickedPlace(picked){
  state.selectedLat = Number(picked.latitude);
  state.selectedLon = Number(picked.longitude);
  state.placeLabel = picked.name || null;
  state.source = "Open-Meteo";
  invalidateRanking();

  await fetchPopsBySlotsSWR(state.selectedLat, state.selectedLon, {
    onCached: ({ pops, tz }) => {
      state.pops = pops;
      state.tz = tz || "Asia/Tokyo";
      render();
    }
  }).then(async ({ pops, tz }) => {
    state.pops = pops;
    state.tz = tz || "Asia/Tokyo";
    render();

    const mode = getSelectedMode();
    for (const b of uniqueBucketsFromPops(pops)) {
      warmPublicCache(mode, b).catch(()=>{});
    }

    const rankingKey = getRankingKeyNow();
    await renderRankingOnce(rankingKey);
    await pingUsageOncePerDay("weather_ok");
  }).catch(err => {
    console.warn("weather fetch failed", err);
    renderEmpty();
    alert(`天気取得に失敗しました：${err?.message || err}`);
  });
}

// =========================
// 投稿一覧（最低限維持）
// =========================
function ensureMySubmissionsDom(){
  let box = document.getElementById("mySubmissions");
  if (box) return box;

  const rankWrap = document.getElementById("todayRankingWrap");
  if (!rankWrap) return null;

  box = document.createElement("div");
  box.id = "mySubmissions";
  box.className = "card";
  box.style.marginTop = "14px";
  box.style.padding = "14px";
  box.innerHTML = `
    <div style="font-weight:900; margin-bottom:8px;">自分の投稿</div>
    <div id="mySubmissionsBody" class="muted">投稿はまだありません</div>
  `;
  rankWrap.insertAdjacentElement("afterend", box);
  return box;
}

function loadMySubmissions(){
  try{
    return JSON.parse(localStorage.getItem("my_submissions_v1") || "[]");
  }catch{
    return [];
  }
}

function renderMySubmissions(){
  ensureMySubmissionsDom();
  const body = document.getElementById("mySubmissionsBody");
  if (!body) return;

  const arr = loadMySubmissions();
  if (!arr.length) {
    body.textContent = "投稿はまだありません";
    return;
  }

  body.innerHTML = arr.slice().reverse().map(it => `
    <div style="padding:8px 0; border-top:1px solid rgba(15,23,42,0.08);">
      <div style="font-weight:700;">${escapeHtml(it.text || "")}</div>
      <div class="muted">${escapeHtml(it.mode === "fun" ? "お笑い" : "雑学")} / ${window.bucket10(Number(it.bucket || 0))}% / ${escapeHtml(it.penName || "匿名")}</div>
    </div>
  `).join("");
}

// =========================
// イベント
// =========================
function bindEvents(){
  const searchBtn = document.getElementById("search");
  const refreshBtn = document.getElementById("refresh");
  const placeInput = document.getElementById("place");

  if (searchBtn) {
    searchBtn.addEventListener("click", async () => {
      const q = String(placeInput?.value || "").trim();
      if (!q) {
        alert("地名を入力してください");
        return;
      }

      try{
        const geo = await geocode(q);
        const list = Array.isArray(geo?.results) ? geo.results : [];
        const pickedList = list.map(x => ({
          name: [x.name, x.admin1, x.country].filter(Boolean).join(", "),
          latitude: Number(x.latitude),
          longitude: Number(x.longitude)
        })).filter(x => Number.isFinite(x.latitude) && Number.isFinite(x.longitude));

        showPlaceSuggestions(pickedList);
      }catch(e){
        alert(`地点検索に失敗しました：${e?.message || e}`);
      }
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      if (state.selectedLat == null || state.selectedLon == null) {
        alert("先に地点を選んでください");
        return;
      }

      try{
        window.__forceRepick = true;
        invalidateRanking();

        const out = await fetchPopsBySlotsSWR(state.selectedLat, state.selectedLon, {
          onCached: ({ pops, tz }) => {
            state.pops = pops;
            state.tz = tz || "Asia/Tokyo";
            render();
          }
        });

        state.pops = out.pops;
        state.tz = out.tz || "Asia/Tokyo";

        const mode = getSelectedMode();
        for (const b of uniqueBucketsFromPops(out.pops)) {
          await warmPublicCache(mode, b).catch(()=>{});
        }

        render();

        const rankingKey = getRankingKeyNow();
        await renderRankingOnce(rankingKey);
      }catch(e){
        alert(`更新失敗：${e?.message || e}`);
      }finally{
        window.__forceRepick = false;
      }
    });
  }

  document.querySelectorAll('input[name="mode"]').forEach(el => {
    el.addEventListener("change", async () => {
      if (!state.pops) return;

      invalidateRanking();
      const mode = getSelectedMode();
      for (const b of uniqueBucketsFromPops(state.pops)) {
        await warmPublicCache(mode, b).catch(()=>{});
      }

      render();

      const rankingKey = getRankingKeyNow();
      await renderRankingOnce(rankingKey);
    });
  });
}

// =========================
// 初期化
// =========================
async function init(){
  try{
    await loadSharedJSON();
  }catch(e){
    console.warn("loadSharedJSON failed", e);
  }

  bindEvents();
  renderEmpty();
  ensureRankingDom();
  ensureMySubmissionsDom();
  renderMySubmissions();

  const buildEl = document.getElementById("build");
  if (buildEl) buildEl.textContent = BUILD;

  try{
    const hall = loadHallDailyCache();
    if (hall?.day === todayJSTString() && Array.isArray(hall.items)) {
      __hofSnapshotMemory = {
        day: hall.day,
        generatedAt: hall.generatedAt || null,
        hofThreshold: Number(hall.hofThreshold || state.hofThreshold || 20),
        items: hall.items.map(normalizeHallSnapshotItem).filter(Boolean)
      };
      __hofSnapshotHtml = buildHallCardHtmlFromSnapshot(__hofSnapshotMemory);
    }
  }catch(e){
    console.warn("initial hall cache load failed", e);
  }
}

document.addEventListener("DOMContentLoaded", init);

// END
