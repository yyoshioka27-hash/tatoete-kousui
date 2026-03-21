// worker.js
// ✅ build marker（反映確認用）
const BUILD = "2026-03-21_hof_daily_snapshot_worker__FULL_v10";

// =======================================================
// ✅ CORS helper（プリフライト確実に通す）
// =======================================================
function corsHeaders(request){
  const req = request.headers.get("Access-Control-Request-Headers");
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": req || "Content-Type, x-admin-key, priority, x-client-id",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin, Access-Control-Request-Headers",
  };
}
const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma": "no-cache"
};

// =======================================================
// 共通レスポンス / ユーティリティ
// =======================================================
function json(data, status = 200, extraHeaders = {}, request = null) {
  const payload = (data === undefined) ? { ok: true } : data;

  const ch = request ? corsHeaders(request) : {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-key, priority, x-client-id",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin, Origin, Access-Control-Request-Headers",
  };

  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...ch,
      ...extraHeaders,
    },
  });
}

function bad(status, msg, extra = {}, request = null) {
  return json({ ok: false, error: msg, ...extra }, status, {}, request);
}

function isAdmin(request, env) {
  const key = request.headers.get("x-admin-key") || "";
  return !!env.ADMIN_KEY && key === env.ADMIN_KEY;
}

function now() { return Date.now(); }

function todayJST() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function normMode(v) {
  const s = String(v || "").trim();
  return (s === "fun") ? "fun" : "trivia";
}

function normBucket(v) {
  const n = Math.max(0, Math.min(100, Number(v)));
  return Math.round(n / 10) * 10;
}

function trimText(v, max = 300) {
  const s = String(v || "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) : s;
}

// =======================================================
// ✅ 重複判定用：本文の正規化（全角/半角・空白ゆれ対策）
// =======================================================
function normDupText(v){
  return String(v || "")
    .normalize("NFKC")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\n+/g, "\n")
    .replace(/\s*[%％]\s*/g, "%")
    .replace(/\s*[:：]\s*/g, "：")
    .replace(/[‐-‒–—―ー]+/g, "ー")
    .replace(/[!！?？。．、,，;；]+$/g, "")
    .trim()
    .toLowerCase();
}

// ✅ seed判定（元ネタ）: id / source / penName で判別
function isSeedPublicItem(it){
  const id = String(it?.id || "");
  const src = String(it?.source || "");
  const pen = String(it?.penName || "");
  return id.startsWith("seedjs_") || src === "seed" || pen.includes("元ネタ");
}

function fingerPrint(request) {
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "";
  const ua = request.headers.get("user-agent") || "";
  return (ip || ua || "anon").slice(0, 200);
}

// ✅ 端末ID（x-client-id優先 / body fallback）
function getClientIdFromReq(request, body){
  const h = String(request.headers.get("x-client-id") || "").trim();
  if (h && h.length <= 120) return h;

  const b = String(body?.clientId || body?.deviceId || body?.cid || "").trim();
  if (b && b.length <= 120) return b;

  return "";
}

function uuid() { return crypto.randomUUID(); }

// =======================================================
// ✅ 安定ID（mode + 正規化本文で生成）
// =======================================================
function fnv1a32(str){
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
function canonicalId(mode, text){
  const m = normMode(mode);
  const t = normDupText(text);
  return `t_${m}_${fnv1a32(`${m}|${t}`)}`;
}
function canonicalTextKey(mode, text){
  return canonicalId(mode, text);
}

// =======================================================
// ✅ クライアント仮ID → 安定ID の別名（alias）救済
// =======================================================
function aliasKey(clientId){
  return `alias:${String(clientId || "").trim()}`;
}
async function putAlias(kv, clientId, stableId){
  const c = String(clientId || "").trim();
  const s = String(stableId || "").trim();
  if (!c || !s) return;
  await kv.put(aliasKey(c), s, { expirationTtl: 60 * 60 * 24 * 30 });
}
async function resolveAlias(kv, maybeId){
  const id = String(maybeId || "").trim();
  if (!id) return "";
  const ali = await kv.get(aliasKey(id));
  return ali ? String(ali).trim() : "";
}

// =======================================================
// ✅ 殿堂入り（閾値）
// =======================================================
function getHofThreshold(env) {
  const v = Number(env.HOF_THRESHOLD || "20");
  if (!Number.isFinite(v) || v < 1) return 20;
  return Math.floor(v);
}
function isHof(totalLikes, env) {
  return Number(totalLikes || 0) >= getHofThreshold(env);
}

// =======================================================
// KV選択（binding名が何でも動くように）
// =======================================================
function pickKV(env) {
  return env.PUBLIC_KV || env.KV || env.DB || env.DATA || env.STORE || env.KV_STORE || null;
}

async function kvGetJSON(kv, key) {
  const s = await kv.get(key);
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}
async function kvPutJSON(kv, key, obj) {
  await kv.put(key, JSON.stringify(obj));
}
async function kvDel(kv, key) {
  await kv.delete(key);
}

// =======================================================
// ✅ prefix の全件数を数える（表示上限200に影響されない）
// =======================================================
async function kvCountPrefix(kv, prefix, maxLoops = 500){
  let cursor = undefined;
  let count = 0;

  for (let loop = 0; loop < maxLoops; loop++){
    const res = await kv.list({ prefix, cursor, limit: 1000 });
    count += (res?.keys?.length || 0);

    if (res?.list_complete === true) break;

    cursor = res?.cursor;
    if (!cursor) break;
  }
  return count;
}

// =======================================================
// Rate limit（1日あたり）
// =======================================================
async function incrLimit(kv, type, fp, maxPerDay) {
  const day = todayJST();
  const key = `lim:${type}:${day}:${fp}`;
  const cur = Number(await kv.get(key) || "0");
  if (cur >= maxPerDay) return { ok: false, cur };
  const next = cur + 1;
  await kv.put(key, String(next), { expirationTtl: 60 * 60 * 24 * 2 });
  return { ok: true, cur: next };
}

// =======================================================
// ✅ ペンネーム登録（救済なし）
// =======================================================
function normPenName(v) {
  const s0 = trimText(v, 40);
  if (!s0) return null;
  const s = s0.normalize("NFKC");
  return s || null;
}

function penKey(name) {
  return `pen:${String(name).trim().normalize("NFKC").toLowerCase()}`;
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function sha256Hex(str) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return toHex(buf);
}
async function verifyOrRegisterPen(kv, env, penName, penPin) {
  const name = normPenName(penName);
  if (!name) return { ok: true, penName: null };

  const pin0 = trimText(penPin, 64);
  const pin = pin0 ? pin0.normalize("NFKC") : "";

  if (!pin) {
    return { ok: false, code: "penpin_required", status: 400, msg: "penpin_required" };
  }

  const key = penKey(name);
  const existing = await kvGetJSON(kv, key);

  const salt = (env.PEN_SALT ? String(env.PEN_SALT) : "tatoete_kousui_salt_v1");
  const hash = await sha256Hex(`${salt}|${name.toLowerCase()}|${pin}`);

  if (!existing) {
    const rec = { name, hash, createdAt: now() };
    await kvPutJSON(kv, key, rec);

    const re = await kvGetJSON(kv, key);
    if (!re || re.hash !== hash) {
      return { ok: false, code: "penname_taken", status: 409, msg: "penname_taken" };
    }
    return { ok: true, penName: re.name };
  }

  if (existing.hash !== hash) {
    return { ok: false, code: "penpin_invalid", status: 403, msg: "penpin_invalid" };
  }

  return { ok: true, penName: existing.name };
}

// =======================================================
// メタ保存（ランキング表示用）
// =======================================================
async function ensureMeta(kv, { id, text, penName, mode, bucket, source }) {
  const metaKey = `meta:${id}`;
  const existing = await kvGetJSON(kv, metaKey);
  if (existing && existing.text) return existing;

  const meta = {
    id,
    text: trimText(text, 300),
    penName: penName ? trimText(penName, 40) : null,
    mode: normMode(mode),
    bucket: normBucket(bucket),
    source: source ? String(source).slice(0, 20) : null,
    createdAt: now(),
    approvedAt: null,
  };
  await kvPutJSON(kv, metaKey, meta);
  return meta;
}

// =======================================================
// ✅ public一覧インデックス（kv.listを使わないため）
// =======================================================
function publicIndexKey(mode, bucket){
  return `idx:public:${normMode(mode)}:${normBucket(bucket)}`;
}
function publicLatestIndexKey(mode){
  return `idx:public_latest:${normMode(mode)}`;
}

async function indexUnshiftId(kv, key, id, maxKeep = 5000){
  let arr = await kvGetJSON(kv, key);
  if (!Array.isArray(arr)) arr = [];

  const sid = String(id || "");
  if (!sid) return arr;

  arr = arr.filter(x => String(x) !== sid);
  arr.unshift(sid);

  if (arr.length > maxKeep) arr = arr.slice(0, maxKeep);
  await kvPutJSON(kv, key, arr);
  return arr;
}

async function indexRemoveIds(kv, key, ids){
  let arr = await kvGetJSON(kv, key);
  if (!Array.isArray(arr)) arr = [];
  const set = new Set((ids || []).map(x => String(x)));
  arr = arr.filter(x => !set.has(String(x)));
  await kvPutJSON(kv, key, arr);
  return arr;
}

// =======================================================
// public/pending 保存
// =======================================================
async function putPending(kv, item) {
  await kvPutJSON(kv, `pending:${item.id}`, item);
  await ensureMeta(kv, item);
}

async function putPublic(kv, item) {
  await kvPutJSON(kv, `public:${item.id}`, item);

  const metaKey = `meta:${item.id}`;
  const meta = {
    id: item.id,
    text: trimText(item.text, 300),
    penName: item.penName ? trimText(item.penName, 40) : null,
    mode: normMode(item.mode),
    bucket: normBucket(item.bucket),
    source: item.source ? String(item.source).slice(0, 20) : "public",
    createdAt: item.createdAt || now(),
    approvedAt: now(),
  };
  await kvPutJSON(kv, metaKey, meta);

  await indexUnshiftId(kv, publicIndexKey(item.mode, item.bucket), item.id, 5000);
  await indexUnshiftId(kv, publicLatestIndexKey(item.mode), item.id, 2000);
}

// =======================================================
// Likes（今日分） & 累計
// =======================================================
async function incLike(kv, id) {
  const day = todayJST();
  const key = `likes:${day}:${id}`;
  const cur = Number(await kv.get(key) || "0");
  const next = cur + 1;
  await kv.put(key, String(next), { expirationTtl: 60 * 60 * 24 * 14 });
  return next;
}

async function incLikeTotal(kv, id) {
  const key = `likes_total:${id}`;
  const cur = Number(await kv.get(key) || "0");
  const next = cur + 1;
  await kv.put(key, String(next));
  return next;
}
async function getLikeTotal(kv, id) {
  return Number(await kv.get(`likes_total:${id}`) || "0");
}
async function getLikeToday(kv, id, day = todayJST()) {
  return Number(await kv.get(`likes:${day}:${id}`) || "0");
}

// ✅ seed / canonical / legacy が分かれていても同じ本文として合算
function seedJsId(mode, bucket, text){
  const m = normMode(mode);
  const b = normBucket(bucket);
  const t = trimText(text, 300);
  return `seedjs_${fnv1a32(`${m}|${b}|${t}`)}`;
}

function buildLogicalIds({ id, mode, bucket, text }) {
  const out = new Set();
  const sid = String(id || "").trim();
  if (sid) out.add(sid);

  const m = normMode(mode);
  const b = normBucket(bucket);
  const t = trimText(text || "", 300);

  if (t) {
    out.add(canonicalId(m, t));
    out.add(seedJsId(m, b, t));
  }
  return Array.from(out).filter(Boolean);
}

async function getMergedLikeTotal(kv, { id, mode, bucket, text }) {
  const ids = buildLogicalIds({ id, mode, bucket, text });
  let total = 0;
  for (const one of ids) {
    total += Number(await kv.get(`likes_total:${one}`) || "0");
  }
  return total;
}

async function getMergedLikeToday(kv, { id, mode, bucket, text }, day = todayJST()) {
  const ids = buildLogicalIds({ id, mode, bucket, text });
  let total = 0;
  for (const one of ids) {
    total += Number(await kv.get(`likes:${day}:${one}`) || "0");
  }
  return total;
}

// =======================================================
// Reports（今日分）
// =======================================================
async function incReport(kv, id) {
  const day = todayJST();
  const key = `reports:${day}:${id}`;
  const cur = Number(await kv.get(key) || "0");
  const next = cur + 1;
  await kv.put(key, String(next), { expirationTtl: 60 * 60 * 24 * 14 });
  return next;
}

// =======================================================
// ✅ canonical統合 helpers
// =======================================================
function preferRow(prev, next){
  const prevSeed = isSeedPublicItem(prev);
  const nextSeed = isSeedPublicItem(next);

  if (prevSeed && !nextSeed) return next;
  if (!prevSeed && nextSeed) return prev;

  const pt = Number(prev.approvedAt || prev.createdAt || 0);
  const nt = Number(next.approvedAt || next.createdAt || 0);
  if (nt > pt) return next;
  if (pt > nt) return prev;

  const prevText = String(prev.text || "");
  const nextText = String(next.text || "");
  if (nextText.length > prevText.length) return next;

  return prev;
}

function mergeCanonicalItems(items, env = null){
  const map = new Map();

  for (const raw of (Array.isArray(items) ? items : [])) {
    const mode = normMode(raw?.mode);
    const text = trimText(raw?.text || "", 300);
    if (!text) continue;

    const key = canonicalTextKey(mode, text);
    const row = {
      id: String(raw?.id || "").trim() || canonicalId(mode, text),
      mode,
      bucket: normBucket(raw?.bucket ?? 0),
      text,
      penName: raw?.penName ? trimText(raw.penName, 40) : null,
      source: raw?.source ? String(raw.source).slice(0, 20) : null,
      likes: Number(raw?.likes || 0),
      totalLikes: Number(raw?.totalLikes || 0),
      createdAt: Number(raw?.createdAt || 0),
      approvedAt: Number(raw?.approvedAt || 0),
      hof: !!raw?.hof,
      _seed: isSeedPublicItem(raw),
    };

    const prev = map.get(key);
    if (!prev) {
      map.set(key, row);
      continue;
    }

    const chosen = preferRow(prev, row);
    const other = (chosen === prev) ? row : prev;

    // ✅ SAFE: ここは max。合算は getMergedLikeTotal / getMergedLikeToday 側に一本化
    chosen.likes = Math.max(Number(chosen.likes || 0), Number(other.likes || 0));
    chosen.totalLikes = Math.max(Number(chosen.totalLikes || 0), Number(other.totalLikes || 0));
    chosen.hof = !!chosen.hof || !!other.hof;
    if (!chosen.penName && other.penName) chosen.penName = other.penName;
    if ((!chosen.source || chosen.source === "seed") && other.source) chosen.source = other.source;

    map.set(key, chosen);
  }

  return Array.from(map.values()).map(x => ({
    id: x.id,
    mode: x.mode,
    bucket: x.bucket,
    text: x.text,
    penName: x.penName || null,
    source: x.source || null,
    likes: Number(x.likes || 0),
    totalLikes: Number(x.totalLikes || 0),
    createdAt: x.createdAt || null,
    approvedAt: x.approvedAt || null,
    hof: env ? isHof(Number(x.totalLikes || 0), env) : !!x.hof,
  }));
}

// =======================================================
// ✅ ランキングの「事前集計」キー（いいね時に更新）
// =======================================================
function rankKeyToday(day, mode, bucket){
  return `rank_today:${day}:${normMode(mode)}:${normBucket(bucket)}`;
}
function rankKeyTotal(mode, bucket){
  return `rank_total:${normMode(mode)}:${normBucket(bucket)}`;
}
function rankKeyTodayAll(day, mode){
  return `rank_today_all:${day}:${normMode(mode)}`;
}
function rankKeyTotalAll(mode){
  return `rank_total_all:${normMode(mode)}`;
}

async function upsertRankList(kv, key, entry, limit = 50){
  let list = await kvGetJSON(kv, key);
  if (!Array.isArray(list)) list = [];

  const mode = normMode(entry?.mode || "trivia");
  const text = trimText(entry?.text || "", 300);
  const logicalId = text ? canonicalId(mode, text) : String(entry?.id || "").trim();
  if (!logicalId) return list;

  const idx = list.findIndex(x => {
    const xm = normMode(x?.mode || mode);
    const xt = trimText(x?.text || "", 300);
    if (xt) return canonicalId(xm, xt) === logicalId;
    return String(x?.id || "").trim() === logicalId;
  });

  const mergedEntry = {
    ...entry,
    id: logicalId,
    mode,
    text,
    penName: entry?.penName ? trimText(entry.penName, 40) : null,
    source: entry?.source ? String(entry.source).slice(0, 20) : null,
    updatedAt: now(),
  };

  if (idx >= 0) {
    const prev = list[idx];
    list[idx] = {
      ...prev,
      ...mergedEntry,
      likes: Number(mergedEntry?.likes ?? prev?.likes ?? 0),
      totalLikes: Number(mergedEntry?.totalLikes ?? prev?.totalLikes ?? 0),
      penName: mergedEntry.penName || prev.penName || null,
      source: mergedEntry.source || prev.source || null,
    };
  } else {
    list.push(mergedEntry);
  }

  list.sort((a, b) => Number(b.likes ?? b.totalLikes ?? 0) - Number(a.likes ?? a.totalLikes ?? 0));
  if (list.length > limit) list = list.slice(0, limit);

  await kvPutJSON(kv, key, list);
  return list;
}

// ✅ ランキング（今日）
async function getRankingToday(kv, { mode, bucket, limit }) {
  const lim = Math.max(1, Math.min(50, Number(limit || 3)));
  const day = todayJST();

  const key = rankKeyToday(day, mode, bucket);
  const list = await kvGetJSON(kv, key);
  if (!Array.isArray(list)) return [];

  const rows = [];
  for (const x of list) {
    const likes = await getMergedLikeToday(kv, {
      id: x.id,
      mode,
      bucket,
      text: x.text,
    }, day);

    rows.push({
      id: canonicalId(mode, x.text || ""),
      mode,
      bucket,
      text: x.text,
      penName: x.penName || null,
      source: x.source || null,
      likes
    });
  }

  const merged = mergeCanonicalItems(rows)
    .sort((a, b) => Number(b.likes || 0) - Number(a.likes || 0));

  return merged.slice(0, lim).map(x => ({
    id: x.id,
    text: x.text,
    penName: x.penName || null,
    source: x.source || null,
    likes: Number(x.likes || 0),
  }));
}

// ✅ ランキング（累計）
async function getRankingTotal(kv, { mode, bucket, limit }, env) {
  const lim = Math.max(1, Math.min(1000, Number(limit || 10)));

  const key = rankKeyTotal(mode, bucket);
  const list = await kvGetJSON(kv, key);
  if (!Array.isArray(list)) return [];

  const rows = [];
  for (const x of list) {
    const totalLikes = await getMergedLikeTotal(kv, {
      id: x.id,
      mode,
      bucket,
      text: x.text,
    });

    rows.push({
      id: canonicalId(mode, x.text || ""),
      mode,
      bucket,
      text: x.text,
      penName: x.penName || null,
      source: x.source || null,
      totalLikes,
    });
  }

  const merged = mergeCanonicalItems(rows, env)
    .sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));

  return merged.slice(0, lim).map(x => ({
    id: x.id,
    text: x.text,
    penName: x.penName || null,
    source: x.source || null,
    totalLikes: Number(x.totalLikes || 0),
    hof: isHof(Number(x.totalLikes || 0), env),
  }));
}

// ✅ 全バケット共通の累計ランキング（モード別）
async function getRankingTotalAllBuckets(kv, { mode, limit }, env) {
  const lim = Math.max(1, Math.min(500, Number(limit || 200)));

  const keyAll = rankKeyTotalAll(mode);
  const listAll = await kvGetJSON(kv, keyAll);
  if (Array.isArray(listAll) && listAll.length) {
    const rows = [];
    for (const x of listAll) {
      const totalLikes = await getMergedLikeTotal(kv, {
        id: x.id,
        mode,
        bucket: x.bucket ?? 0,
        text: x.text,
      });

      rows.push({
        id: canonicalId(mode, x.text || ""),
        mode,
        text: x.text,
        penName: x.penName || null,
        source: x.source || null,
        totalLikes,
      });
    }

    const mergedAll = mergeCanonicalItems(rows, env)
      .sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0));

    return mergedAll.slice(0, lim).map(x => ({
      id: x.id,
      text: x.text,
      penName: x.penName || null,
      source: x.source || null,
      totalLikes: Number(x.totalLikes || 0),
      hof: isHof(Number(x.totalLikes || 0), env),
    }));
  }

  const buckets = [0,10,20,30,40,50,60,70,80,90,100];
  const rows = [];

  for (const b of buckets) {
    const key = rankKeyTotal(mode, b);
    const list = await kvGetJSON(kv, key);
    if (!Array.isArray(list) || !list.length) continue;

    for (const x of list) {
      const totalLikes = await getMergedLikeTotal(kv, {
        id: x.id,
        mode,
        bucket: b,
        text: x.text,
      });

      rows.push({
        id: canonicalId(mode, x.text || ""),
        mode,
        bucket: b,
        text: x.text,
        penName: x.penName || null,
        source: x.source || null,
        totalLikes,
      });
    }
  }

  return mergeCanonicalItems(rows, env)
    .sort((a,b) => Number(b.totalLikes||0) - Number(a.totalLikes||0))
    .slice(0, lim)
    .map(x => ({
      id: x.id,
      text: x.text,
      penName: x.penName || null,
      source: x.source || null,
      totalLikes: Number(x.totalLikes || 0),
      hof: isHof(Number(x.totalLikes || 0), env),
    }));
}

// 殿堂入り一覧（旧：bucket別）
async function getHallOfFame(kv, { mode, bucket, limit }, env) {
  const threshold = getHofThreshold(env);
  const items = await getRankingTotal(
    kv,
    { mode, bucket, limit: Math.max(30, Number(limit || 200)) },
    env
  );
  const hof = items.filter(x => Number(x.totalLikes || 0) >= threshold);
  const lim = Math.max(1, Math.min(200, Number(limit || 200)));
  return hof.slice(0, lim);
}

// ✅ 殿堂入り一覧（新：全バケット共通）
async function getHallOfFameAll(kv, { mode, limit }, env) {
  const threshold = getHofThreshold(env);
  const items = await getRankingTotalAllBuckets(
    kv,
    { mode, limit: Math.max(200, Number(limit || 200)) },
    env
  );
  const hof = items.filter(x => Number(x.totalLikes || 0) >= threshold);
  const lim = Math.max(1, Math.min(200, Number(limit || 200)));
  return hof.slice(0, lim);
}

// =======================================================
// ✅ 殿堂入り日次スナップショット
// - 1日1回だけ作ってKVに保存
// - フロントはこれを読むだけでよい
// =======================================================
function hallDailyKey(day){
  return `hall_daily:${String(day || "").trim()}`;
}

function toIsoJst(ts = Date.now()){
  const d = new Date(ts + 9 * 60 * 60 * 1000);
  return d.toISOString().replace("Z", "+09:00");
}

async function buildHallDailySnapshot(kv, env, {
  day = todayJST(),
  limitPerMode = 200,
  topAll = 200
} = {}) {
  const trivia = await getHallOfFameAll(kv, { mode: "trivia", limit: limitPerMode }, env);
  const fun    = await getHallOfFameAll(kv, { mode: "fun",    limit: limitPerMode }, env);

  const merged = mergeCanonicalItems([
    ...(Array.isArray(trivia) ? trivia.map(x => ({ ...x, mode: "trivia" })) : []),
    ...(Array.isArray(fun)    ? fun.map(x => ({ ...x, mode: "fun"    })) : []),
  ], env)
    .sort((a, b) => {
      const diff = Number(b.totalLikes || 0) - Number(a.totalLikes || 0);
      if (diff !== 0) return diff;
      return Number(b.approvedAt || b.createdAt || 0) - Number(a.approvedAt || a.createdAt || 0);
    })
    .slice(0, Math.max(1, Math.min(500, Number(topAll || 200))));

  const items = merged.map((x, idx) => ({
    rank: idx + 1,
    id: x.id,
    mode: normMode(x.mode),
    bucket: normBucket(x.bucket ?? 0),
    text: trimText(x.text || "", 300),
    penName: x.penName || null,
    source: x.source || null,
    totalLikes: Number(x.totalLikes || 0),
    hof: true,
    approvedAt: x.approvedAt || null,
    createdAt: x.createdAt || null,
  }));

  const snapshot = {
    ok: true,
    type: "hall_of_fame_daily",
    day: String(day),
    generatedAt: toIsoJst(Date.now()),
    hofThreshold: getHofThreshold(env),
    count: items.length,
    items,
    build: BUILD
  };

  await kvPutJSON(kv, hallDailyKey(day), snapshot);
  return snapshot;
}

async function getHallDailySnapshot(kv, env, day = todayJST()){
  const hit = await kvGetJSON(kv, hallDailyKey(day));
  if (hit && Array.isArray(hit.items)) {
    return hit;
  }
  return null;
}

// =======================================================
// admin 共通
// =======================================================
async function adminListPending(kv) {
  const out = [];
  let cursor = undefined;

  for (let loop = 0; loop < 50; loop++) {
    const listed = await kv.list({ prefix: "pending:", cursor, limit: 1000 });
    for (const k of listed.keys) {
      const it = await kvGetJSON(kv, k.name);
      if (!it) continue;
      out.push(it);
    }
    cursor = listed.cursor;
    if (!cursor) break;
  }

  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return out;
}

async function adminListPublic(kv, { mode = null, bucket = null, limit = 5000 } = {}) {
  const out = [];
  let cursor = undefined;

  for (let loop = 0; loop < 50; loop++) {
    const listed = await kv.list({ prefix: "public:", cursor, limit: 1000 });
    for (const k of listed.keys) {
      const it = await kvGetJSON(kv, k.name);
      if (!it) continue;

      if (mode && normMode(it.mode) !== mode) continue;
      if (bucket != null && normBucket(it.bucket) !== bucket) continue;

      out.push(it);
      if (out.length >= limit) break;
    }
    if (out.length >= limit) break;

    cursor = listed.cursor;
    if (!cursor) break;
  }

  out.sort((a, b) => (b.approvedAt || b.createdAt || 0) - (a.approvedAt || a.createdAt || 0));
  return out;
}

async function adminApproveOne(kv, id) {
  const pendingKey = `pending:${id}`;
  const pending = await kvGetJSON(kv, pendingKey);

  if (!pending) {
    const pub = await kvGetJSON(kv, `public:${id}`);
    if (pub) {
      return { ok: true, id, note: "already_public" };
    }

    const meta = await kvGetJSON(kv, `meta:${id}`);

    return {
      ok: false,
      status: 404,
      error: "pending not found",
      id,
      diag: {
        hasPublic: !!pub,
        hasMeta: !!meta,
        pendingKey
      }
    };
  }

  const item = { ...pending, source: "public", approvedAt: now() };
  await putPublic(kv, item);
  await kvDel(kv, pendingKey);

  return { ok: true, id };
}

async function adminRejectOne(kv, id) {
  await kvDel(kv, `pending:${id}`);

  const legacy = await kvGetJSON(kv, "pending");
  if (Array.isArray(legacy)) {
    const next = legacy.filter(x => String(x?.id) !== String(id));
    await kvPutJSON(kv, "pending", next);
  }

  return { ok: true, id };
}

// =======================================================
// admin: 削除（public/pending両対応 + お掃除オプション）
// =======================================================
function normScope(v) {
  const s = String(v || "both").trim().toLowerCase();
  if (s === "public" || s === "pending") return s;
  return "both";
}

async function adminDeleteIds(kv, ids, scope, opt = {}) {
  const wipeMeta = !!opt.wipeMeta;
  const wipeTotals = !!opt.wipeTotals;
  const deleted = { public: 0, pending: 0, meta: 0, totals: 0, index: 0 };
  const doneIds = [];

  for (const id0 of ids) {
    const id = String(id0 || "").trim();
    if (!id) continue;

    let touched = false;

    let meta = null;
    if (scope === "public" || scope === "both") {
      meta = await kvGetJSON(kv, `meta:${id}`);

      const existed = !!(await kv.get(`public:${id}`));
      await kvDel(kv, `public:${id}`);
      if (existed) { deleted.public++; touched = true; }

      const m = meta?.mode ? normMode(meta.mode) : null;
      const b = (meta?.bucket != null) ? normBucket(meta.bucket) : null;
      if (m && b != null) {
        await indexRemoveIds(kv, publicIndexKey(m, b), [id]);
        deleted.index++;
      }
      if (m) {
        await indexRemoveIds(kv, publicLatestIndexKey(m), [id]);
      }
    }

    if (scope === "pending" || scope === "both") {
      const existed = !!(await kv.get(`pending:${id}`));
      await kvDel(kv, `pending:${id}`);
      if (existed) { deleted.pending++; touched = true; }
    }

    if (wipeMeta) {
      const existed = !!(await kv.get(`meta:${id}`));
      await kvDel(kv, `meta:${id}`);
      if (existed) deleted.meta++;
    }
    if (wipeTotals) {
      const existed = !!(await kv.get(`likes_total:${id}`));
      await kvDel(kv, `likes_total:${id}`);
      if (existed) deleted.totals++;
    }

    if (touched) doneIds.push(id);
  }

  return { ok: true, deleted, ids: doneIds, scope, wipeMeta, wipeTotals };
}

async function adminDeleteAll(kv, scope) {
  const deleted = { public: 0, pending: 0, index: 0 };

  if (scope === "public" || scope === "both") {
    let cursor = undefined;
    for (let loop = 0; loop < 200; loop++) {
      const listed = await kv.list({ prefix: "public:", cursor, limit: 1000 });
      for (const k of listed.keys) { await kvDel(kv, k.name); deleted.public++; }
      cursor = listed.cursor;
      if (!cursor) break;
    }

    let c1 = undefined;
    for (let loop = 0; loop < 200; loop++) {
      const listed = await kv.list({ prefix: "idx:public:", cursor: c1, limit: 1000 });
      for (const k of listed.keys) { await kvDel(kv, k.name); deleted.index++; }
      c1 = listed.cursor;
      if (!c1) break;
    }
    let c2 = undefined;
    for (let loop = 0; loop < 50; loop++) {
      const listed = await kv.list({ prefix: "idx:public_latest:", cursor: c2, limit: 1000 });
      for (const k of listed.keys) { await kvDel(kv, k.name); deleted.index++; }
      c2 = listed.cursor;
      if (!c2) break;
    }
  }

  if (scope === "pending" || scope === "both") {
    let cursor = undefined;
    for (let loop = 0; loop < 200; loop++) {
      const listed = await kv.list({ prefix: "pending:", cursor, limit: 1000 });
      for (const k of listed.keys) { await kvDel(kv, k.name); deleted.pending++; }
      cursor = listed.cursor;
      if (!cursor) break;
    }
  }

  return { ok: true, deleted, all: true, scope };
}

// =======================================================
// admin: seed取り込み用（admin.html と同一ID体系）
// =======================================================
async function adminImportSeed(kv, items){
  const list = Array.isArray(items) ? items : [];
  const ts = now();

  let wrote = 0;
  let skipped = 0;

  for (const it of list){
    const mode = normMode(it?.mode);
    const bucket = normBucket(it?.bucket);
    const text = trimText(it?.text, 300);
    if (!text) continue;

    const id = seedJsId(mode, bucket, text);

    const exists = (await kv.get(`public:${id}`)) || (await kv.get(`pending:${id}`));
    if (exists){
      skipped++;
      continue;
    }

    const item = {
      id,
      mode,
      bucket,
      text,
      penName: "元ネタ(metaphors.js)",
      source: "seed",
      createdAt: ts,
      approvedAt: ts,
    };

    await putPublic(kv, item);
    wrote++;
  }

  return { wrote, skipped, total: list.length };
}

// =======================================================
// ✅ 承認API: 受けるパスを全部統合
// =======================================================
function isApprovePath(pathname){
  const p = String(pathname || "").trim();
  const pl = p.toLowerCase();

  const norm = (s) => s.replace(/\/+$/, "");
  const n = norm(pl);

  return (
    n === "/api/admin/approve" ||
    n === "/api/admin/approvepending" ||
    n === "/api/admin/approve_pending" ||
    n === "/api/admin/publish" ||
    n === "/api/approve" ||
    n === "/api/approvepending" ||
    n === "/api/approve_pending" ||
    n === "/api/publish"
  );
}

function normalizeIncomingId(v){
  let s = String(v || "").trim();
  if (!s) return "";
  s = s.replace(/^(pending|public|meta)\s*:\s*/i, "");
  s = s.trim();
  return s;
}

function pickIdsFromBody(body){
  const ids = [];
  if (body && typeof body === "object") {
    if (body.id != null) {
      const s = normalizeIncomingId(body.id);
      if (s) ids.push(s);
    }
    if (body.key != null) {
      const s = normalizeIncomingId(body.key);
      if (s) ids.push(s);
    }

    if (Array.isArray(body.ids)) {
      for (const v of body.ids) {
        const s = normalizeIncomingId(v);
        if (s) ids.push(s);
      }
    }
    if (Array.isArray(body.keys)) {
      for (const v of body.keys) {
        const s = normalizeIncomingId(v);
        if (s) ids.push(s);
      }
    }
  }
  return Array.from(new Set(ids));
}

// =======================================================
// ✅ admin: public index を再構築
// =======================================================
async function adminReindexPublic(kv, { mode = null, bucket = null, max = 20000 } = {}) {
  const map = new Map();

  let cursor = undefined;
  let scanned = 0;

  for (let loop = 0; loop < 200; loop++) {
    const listed = await kv.list({ prefix: "public:", cursor, limit: 1000 });

    for (const k of listed.keys) {
      const it = await kvGetJSON(kv, k.name);
      if (!it) continue;

      const m = normMode(it.mode);
      const b = normBucket(it.bucket);

      if (mode && m !== mode) continue;
      if (bucket != null && b !== bucket) continue;

      const idxKey = publicIndexKey(m, b);
      if (!map.has(idxKey)) map.set(idxKey, new Set());
      map.get(idxKey).add(String(it.id));

      scanned++;
      if (scanned >= max) break;
    }
    if (scanned >= max) break;

    cursor = listed.cursor;
    if (!cursor) break;
  }

  let wrote = 0;

  for (const [idxKey, idSet] of map.entries()) {
    let existing = await kvGetJSON(kv, idxKey);
    if (!Array.isArray(existing)) existing = [];

    for (const id of existing) idSet.add(String(id));

    const merged = Array.from(idSet).map(x => String(x || "").trim()).filter(Boolean).slice(0, 5000);

    await kvPutJSON(kv, idxKey, merged);
    wrote++;
  }

  return { ok: true, scanned, wrote, note: "reindex_done" };
}

// =======================================================
// ✅ admin: public_latest index を再構築（全バケット共通・新しい順）
// =======================================================
async function adminReindexLatest(kv, { mode = null, max = 20000, maxKeep = 2000 } = {}) {
  const rows = [];
  let cursor = undefined;
  let scanned = 0;

  for (let loop = 0; loop < 200; loop++) {
    const listed = await kv.list({ prefix: "public:", cursor, limit: 1000 });

    for (const k of listed.keys) {
      const it = await kvGetJSON(kv, k.name);
      if (!it) continue;

      const m = normMode(it.mode);
      if (mode && m !== mode) continue;

      const id = String(it.id || "").trim();
      if (!id) continue;

      const approvedAt0 = it.approvedAt ?? null;
      const createdAt0 = it.createdAt ?? null;

      rows.push({
        id,
        mode: m,
        approvedAt: Number(approvedAt0 || 0),
        createdAt: Number(createdAt0 || 0),
        needMeta: (approvedAt0 == null)
      });

      scanned++;
      if (scanned >= max) break;
    }

    if (scanned >= max) break;

    cursor = listed.cursor;
    if (!cursor) break;
  }

  const need = rows.filter(r => r.needMeta);
  const CONC = 16;

  async function runWithLimit(list, worker, limit){
    const results = new Array(list.length);
    let i = 0;
    const runners = Array.from({ length: Math.min(limit, list.length) }, async () => {
      while (true){
        const idx = i++;
        if (idx >= list.length) break;
        try{
          results[idx] = await worker(list[idx], idx);
        }catch(e){
          results[idx] = { ok:false, err:String(e?.message || e) };
        }
      }
    });
    await Promise.all(runners);
    return results;
  }

  await runWithLimit(need, async (r) => {
    const meta = await kvGetJSON(kv, `meta:${r.id}`);
    if (meta?.approvedAt != null) r.approvedAt = Number(meta.approvedAt || 0);
    if (r.createdAt === 0 && meta?.createdAt != null) r.createdAt = Number(meta.createdAt || 0);
    r.needMeta = false;
    return { ok:true };
  }, CONC);

  rows.sort((a, b) => (b.approvedAt - a.approvedAt) || (b.createdAt - a.createdAt));

  const targets = mode ? [mode] : ["trivia", "fun"];
  const wrote = {};

  for (const m of targets) {
    const ids = rows
      .filter(r => r.mode === m)
      .map(r => r.id)
      .filter(Boolean);

    const seen = new Set();
    const uniq = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      uniq.push(id);
      if (uniq.length >= maxKeep) break;
    }

    await kvPutJSON(kv, publicLatestIndexKey(m), uniq);
    wrote[m] = uniq.length;
  }

  return { ok: true, scanned, wrote, maxKeep, note: "reindex_latest_done" };
}

// =======================================================
// ✅ public 取得ヘルパー
// - /api/public の返却順を「新しい順」に寄せる
// - 同本文重複は canonical 単位で通常ネタ優先
// - ✅ FIX: totalLikes は canonical 合算で返す
// =======================================================
async function collectPublicItemsForBucket(kv, { mode, bucket, limit, env }) {
  const key = publicIndexKey(mode, bucket);
  const ids = await kvGetJSON(kv, key);

  if (!Array.isArray(ids) || ids.length === 0) {
    return { items: [], note: "no_index_or_empty" };
  }

  const CONC = 16;
  const scanN = Math.min(ids.length, Math.max(limit * 2, 120));
  const tasks = [];

  for (let i = 0; i < scanN; i++) {
    const id = String(ids[i] || "").trim();
    if (!id) continue;
    tasks.push({ idx: i, id });
  }

  async function runWithLimit(list, worker, limitN){
    const results = new Array(list.length);
    let ptr = 0;
    const runners = Array.from({ length: Math.min(limitN, list.length) }, async () => {
      while (true){
        const k = ptr++;
        if (k >= list.length) break;
        try{
          results[k] = await worker(list[k], k);
        }catch{
          results[k] = null;
        }
      }
    });
    await Promise.all(runners);
    return results;
  }

  const rows = await runWithLimit(tasks, async (t) => {
    let it = await kvGetJSON(kv, `public:${t.id}`);
    if (!it) return null;

    if (normMode(it.mode) !== mode) return null;
    if (normBucket(it.bucket) !== bucket) return null;

    if (isSeedPublicItem(it)) {
      const cid = canonicalId(it.mode, it.text);
      const alt = await kvGetJSON(kv, `public:${cid}`);
      if (alt && !isSeedPublicItem(alt)) {
        it = alt;
      }
    }

    const totalLikes = await getMergedLikeTotal(kv, {
      id: it.id,
      mode: it.mode,
      bucket: it.bucket,
      text: it.text
    });
    const meta = await kvGetJSON(kv, `meta:${it.id}`);

    const approvedAt = Number(meta?.approvedAt || it.approvedAt || 0);
    const createdAt = Number(meta?.createdAt || it.createdAt || 0);

    return {
      idx: t.idx,
      id: canonicalId(it.mode, it.text),
      mode: normMode(it.mode),
      bucket: normBucket(it.bucket),
      text: it.text,
      penName: it.penName || null,
      createdAt: it.createdAt || null,
      approvedAt: approvedAt || null,
      totalLikes,
      hof: isHof(totalLikes, env),
      source: it.source || "public",
    };
  }, CONC);

  const merged = mergeCanonicalItems(rows.filter(Boolean), env)
    .sort((a, b) => {
      const at = Number(a.approvedAt || a.createdAt || 0);
      const bt = Number(b.approvedAt || b.createdAt || 0);
      if (bt !== at) return bt - at;
      return 0;
    })
    .slice(0, limit);

  return { items: merged, note: "ok" };
}

// =======================================================
// Router
// =======================================================
export default {
  async fetch(request, env, ctx) {
    try {
      const kv = pickKV(env);
      if (!kv) return bad(500, "KV binding not found (env.KV / env.DB etc.)", {}, request);

      const url = new URL(request.url);
      const pathRaw = (url.pathname || "/").replace(/\/+$/, "") || "/";
      const pathLower = pathRaw.toLowerCase();

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }

      if (pathLower === "/api/health") {
        return json({
          ok: true,
          status: "ok",
          kv: true,
          hofThreshold: getHofThreshold(env),
          build: BUILD
        }, 200, NO_STORE, request);
      }

      // ===================================================
      // ✅ usage ping（public） + ✅ rate limit
      // ===================================================
      if (pathLower === "/api/usage/ping" && request.method === "POST") {
        const fp = fingerPrint(request);
        const lim = await incrLimit(kv, "usage", fp, 200);
        if (!lim.ok) return bad(429, "usage ping limit exceeded", {}, request);

        let body = null;
        try { body = await request.json(); } catch { body = null; }

        const deviceId =
          String(body?.deviceId || "").trim() ||
          String(url.searchParams.get("deviceId") || url.searchParams.get("d") || "").trim() ||
          String(request.headers.get("x-device-id") || "").trim();

        if (!deviceId || deviceId.length > 120) {
          return bad(400, "deviceId required", {}, request);
        }

        const day = todayJST();
        const seenKey = `usage_seen:${day}:${deviceId}`;
        const already = await kv.get(seenKey);
        if (already) {
          const cur = Number(await kv.get(`usage_count:${day}`) || "0");
          return json({ ok: true, day, counted: false, count: cur }, 200, NO_STORE, request);
        }

        await kv.put(seenKey, "1", { expirationTtl: 60 * 60 * 24 * 2 });

        const countKey = `usage_count:${day}`;
        const cur = Number(await kv.get(countKey) || "0");
        const next = cur + 1;
        await kv.put(countKey, String(next), { expirationTtl: 60 * 60 * 24 * 60 });

        return json({ ok: true, day, counted: true, count: next }, 200, NO_STORE, request);
      }

      if (pathLower === "/api/admin/usage" && request.method === "GET") {
        if (!isAdmin(request, env)) return bad(403, "forbidden", {}, request);
        const day = todayJST();
        const count = Number(await kv.get(`usage_count:${day}`) || "0");
        return json({ ok: true, day, count, build: BUILD }, 200, NO_STORE, request);
      }

      if (pathLower === "/api/admin/usage/today" && request.method === "GET") {
        if (!isAdmin(request, env)) return bad(403, "forbidden", {}, request);
        const day = todayJST();
        const count = Number(await kv.get(`usage_count:${day}`) || "0");
        return json({ ok: true, day, count, build: BUILD }, 200, NO_STORE, request);
      }

      if (
        (pathLower === "/api/admin/stats" || pathLower === "/api/admin/dau")
        && request.method === "GET"
      ) {
        if (!isAdmin(request, env)) return bad(403, "forbidden", {}, request);

        const day = todayJST();

        const dJ = new Date(Date.now() + 9 * 60 * 60 * 1000);
        dJ.setDate(dJ.getDate() - 1);
        const yesterday = dJ.toISOString().slice(0, 10);

        const dauToday = Number(await kv.get(`usage_count:${day}`) || "0");
        const dauYesterday = Number(await kv.get(`usage_count:${yesterday}`) || "0");

        const last7 = [];
        for (let i = 0; i < 7; i++) {
          const dd = new Date(Date.now() + 9 * 60 * 60 * 1000);
          dd.setDate(dd.getDate() - i);
          const k = dd.toISOString().slice(0, 10);
          const c = Number(await kv.get(`usage_count:${k}`) || "0");
          last7.push({ day: k, count: c });
        }

        const publicCount  = await kvCountPrefix(kv, "public:");
        const pendingCount = await kvCountPrefix(kv, "pending:");
        const totalIdeas   = publicCount + pendingCount;

        return json({
          ok: true,
          day,
          yesterday,
          dauToday,
          dauYesterday,
          today: dauToday,
          count: dauToday,
          last7,
          publicCount,
          pendingCount,
          totalIdeas,
          build: BUILD
        }, 200, NO_STORE, request);
      }

      if (pathLower === "/api/penname/auth" && request.method === "POST") {
        let body = null;
        try { body = await request.json(); } catch { body = null; }
        if (!body) return bad(400, "bad json", {}, request);

        const penNameRaw = normPenName(body.penName);
        const penPin = body.penPin || body.pin || null;

        const penRes = await verifyOrRegisterPen(kv, env, penNameRaw, penPin);
        if (!penRes.ok) return bad(penRes.status, penRes.msg, { code: penRes.code }, request);

        return json({ ok: true, penName: penRes.penName }, 200, NO_STORE, request);
      }

      // --- submit ---
      if (pathLower === "/api/submit" && request.method === "POST") {
        const fp = fingerPrint(request);
        const lim = await incrLimit(kv, "submit", fp, 10);
        if (!lim.ok) return bad(429, "submit limit per day exceeded (10)", {}, request);

        let body = null;
        try { body = await request.json(); } catch { body = null; }
        if (!body) return bad(400, "bad json", {}, request);

        const mode = normMode(body.mode);
        const bucket = normBucket(body.bucket);
        const text = trimText(body.text, 300);
        const penNameRaw = normPenName(body.penName);
        const penPin = body.penPin || body.pin || null;

        if (!text) return bad(400, "text required", {}, request);

        const penRes = await verifyOrRegisterPen(kv, env, penNameRaw, penPin);
        if (!penRes.ok) return bad(penRes.status, penRes.msg, { code: penRes.code }, request);

        const stableId = canonicalId(mode, text);

        const clientId = String(body.clientId || body.localId || body.tmpId || body.id || "").trim();
        if (clientId && clientId !== stableId) {
          await putAlias(kv, clientId, stableId);
        }

        const existsPub = await kv.get(`public:${stableId}`);
        if (existsPub) return json({ ok: true, id: stableId, note: "already_public" }, 200, NO_STORE, request);

        const existsPen = await kv.get(`pending:${stableId}`);
        if (existsPen) return json({ ok: true, id: stableId, note: "already_pending" }, 200, NO_STORE, request);

        const item = {
          id: stableId,
          mode,
          bucket,
          text,
          penName: penRes.penName,
          source: "pending",
          createdAt: now(),
        };

        await putPending(kv, item);
        return json({ ok: true, id: item.id }, 200, NO_STORE, request);
      }

      // --- public list ---
      if (pathLower === "/api/public" && request.method === "GET") {
        const mode = normMode(url.searchParams.get("mode"));
        const bucket = normBucket(url.searchParams.get("bucket"));
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || "50")));

        const result = await collectPublicItemsForBucket(kv, { mode, bucket, limit, env });
        return json(
          { ok: true, items: result.items, hofThreshold: getHofThreshold(env), note: result.note },
          200,
          NO_STORE,
          request
        );
      }

      // --- public latest ---
      if (pathLower === "/api/public_latest" && request.method === "GET") {
        const mode = normMode(url.searchParams.get("mode"));
        const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || "20")));

        const key = publicLatestIndexKey(mode);
        const ids = await kvGetJSON(kv, key);

        if (!Array.isArray(ids) || ids.length === 0) {
          return json(
            { ok: true, items: [], hofThreshold: getHofThreshold(env), note: "no_latest_index" },
            200, NO_STORE, request
          );
        }

        const raw = [];
        const needCount = Math.max(limit * 2, 24);

        for (let i = 0; i < ids.length && raw.length < needCount; i++){
          const id0 = String(ids[i] || "").trim();
          if (!id0) continue;

          let it = await kvGetJSON(kv, `public:${id0}`);
          if (!it) continue;

          if (isSeedPublicItem(it)) {
            const cid = canonicalId(it.mode, it.text);
            const alt = await kvGetJSON(kv, `public:${cid}`);
            if (alt && !isSeedPublicItem(alt)) {
              it = alt;
            }
          }

          if (normMode(it.mode) !== mode) continue;

          let approvedAt = it.approvedAt || null;
          const meta = await kvGetJSON(kv, `meta:${it.id}`);
          if (meta?.approvedAt != null) approvedAt = meta.approvedAt;

          raw.push({
            id: canonicalId(it.mode, it.text),
            mode: normMode(it.mode),
            bucket: normBucket(it.bucket),
            text: it.text,
            penName: it.penName || null,
            approvedAt: Number(approvedAt || 0),
            createdAt: Number(it.createdAt || 0),
            source: it.source || "public",
          });
        }

        const out = mergeCanonicalItems(raw, env)
          .sort((a, b) => Number(b.approvedAt || b.createdAt || 0) - Number(a.approvedAt || a.createdAt || 0))
          .slice(0, limit)
          .map(it => ({
            id: it.id,
            mode: normMode(it.mode),
            bucket: normBucket(it.bucket),
            text: it.text,
            penName: it.penName || null,
            approvedAt: it.approvedAt || null,
          }));

        return json({ ok: true, items: out, hofThreshold: getHofThreshold(env) }, 200, NO_STORE, request);
      }

      // --- 互換: /api/list（publicのみ） ---
      if (pathLower === "/api/list" && request.method === "GET") {
        if (!isAdmin(request, env)) return bad(403, "forbidden", {}, request);

        const modeQ = url.searchParams.get("mode");
        const bucketQ = url.searchParams.get("bucket");
        const limit = Math.max(1, Math.min(5000, Number(url.searchParams.get("limit") || "5000")));

        const mode = (modeQ == null || modeQ === "" || modeQ === "all") ? null : normMode(modeQ);
        const bucket = (bucketQ == null || bucketQ === "" || bucketQ === "all") ? null : normBucket(bucketQ);

        const out = await adminListPublic(kv, { mode, bucket, limit });
        return json({ ok: true, items: out }, 200, NO_STORE, request);
      }

      // --- like ---
      if (pathLower === "/api/like" && request.method === "POST") {
        let body = null;
        try { body = await request.json(); } catch { body = null; }
        if (!body) return bad(400, "bad json", {}, request);

        const cid = getClientIdFromReq(request, body);
        const actor = cid ? `cid:${cid}` : `fp:${fingerPrint(request)}`;

        let idRaw = String(body.id || "").trim();
        let mode = normMode(body.mode || "trivia");
        let bucket = normBucket(body.bucket ?? 0);
        let text = trimText(body.text || "", 300);
        let penName = body.penName ? trimText(body.penName, 40) : null;
        let source = body.source || "unknown";

        if (!idRaw && text) {
          idRaw = canonicalId(mode, text);
        }
        if (!idRaw) return bad(400, "id required", {}, request);

        const existsId0 = (await kv.get(`public:${idRaw}`)) || (await kv.get(`pending:${idRaw}`));
        if (!existsId0) {
          const ali = await resolveAlias(kv, idRaw);
          if (ali) idRaw = ali;
        }

        const pub = await kvGetJSON(kv, `public:${idRaw}`);
        const pen = pub ? null : await kvGetJSON(kv, `pending:${idRaw}`);
        const meta0 = await kvGetJSON(kv, `meta:${idRaw}`);
        const src = pub || pen || meta0 || null;

        if (src) {
          mode = normMode(src.mode ?? mode);
          bucket = normBucket(src.bucket ?? bucket);
          text = trimText(src.text || text, 300);
          penName = src.penName ? trimText(src.penName, 40) : penName;
          source = src.source || source;
        }

        if (!text) {
          return bad(400, "text required to resolve canonical like target", {}, request);
        }

        const logicalId = canonicalId(mode, text);
        if (idRaw && idRaw !== logicalId) {
          await putAlias(kv, idRaw, logicalId);
        }

        const limDev = await incrLimit(kv, "like_dev", actor, 10);
        if (!limDev.ok) return bad(429, "like limit per day exceeded (10)", { scope:"device" }, request);

        const ip =
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-forwarded-for") ||
          "";
        const limIp = await incrLimit(kv, "like_ip", (ip || "noip").slice(0,200), 200);
        if (!limIp.ok) return bad(429, "like limit per day exceeded (200)", { scope:"ip" }, request);

        const day = todayJST();
        const likedKey = `liked:${day}:${actor}:${logicalId}`;
        const already = await kv.get(likedKey);
        if (already) return bad(409, "already liked today", {}, request);
        await kv.put(likedKey, "1", { expirationTtl: 60 * 60 * 24 * 2 });

        await ensureMeta(kv, {
          id: logicalId,
          text,
          penName,
          mode,
          bucket,
          source,
        });

        const likesToday = await incLike(kv, logicalId);
        await incLikeTotal(kv, logicalId);
        const totalLikes = await getMergedLikeTotal(kv, {
          id: logicalId,
          mode,
          bucket,
          text
        });

        await upsertRankList(
          kv,
          rankKeyToday(day, mode, bucket),
          { id: logicalId, mode, bucket, likes: likesToday, text, penName, source, updatedAt: now() },
          50
        );
        await upsertRankList(
          kv,
          rankKeyTotal(mode, bucket),
          { id: logicalId, mode, bucket, totalLikes, text, penName, source, updatedAt: now() },
          200
        );

        await upsertRankList(
          kv,
          rankKeyTodayAll(day, mode),
          { id: logicalId, mode, likes: likesToday, text, penName, source, updatedAt: now() },
          200
        );
        await upsertRankList(
          kv,
          rankKeyTotalAll(mode),
          { id: logicalId, mode, totalLikes, text, penName, source, updatedAt: now() },
          500
        );

        return json({
          ok: true,
          id: logicalId,
          likesToday,
          totalLikes,
          hof: isHof(totalLikes, env),
          hofThreshold: getHofThreshold(env)
        }, 200, NO_STORE, request);
      }

      // --- status check ---
      if (pathLower === "/api/status" && request.method === "GET") {
        const idsRaw = String(url.searchParams.get("ids") || "").trim();
        if (!idsRaw) return json({ ok: true, items: [] }, 200, NO_STORE, request);

        const ids = Array.from(new Set(idsRaw.split(",").map(s => s.trim()).filter(Boolean))).slice(0, 50);

        const items = [];
        for (const id0 of ids) {
          let id = String(id0 || "").trim();
          if (!id) continue;

          const hasDirect = !!(await kv.get(`public:${id}`)) || !!(await kv.get(`pending:${id}`));
          if (!hasDirect) {
            const ali = await resolveAlias(kv, id);
            if (ali) id = ali;
          }

          const hasPub = !!(await kv.get(`public:${id}`));
          const hasPen = hasPub ? false : !!(await kv.get(`pending:${id}`));
          let approvedAt = null;

          if (hasPub) {
            const meta = await kvGetJSON(kv, `meta:${id}`);
            approvedAt = meta?.approvedAt ?? null;
          }

          items.push({
            id,
            status: hasPub ? "public" : (hasPen ? "pending" : "missing"),
            approvedAt,
          });
        }

        return json({ ok: true, items }, 200, NO_STORE, request);
      }

      // --- report ---
      if (pathLower === "/api/report" && request.method === "POST") {
        const fp = fingerPrint(request);
        const lim = await incrLimit(kv, "report", fp, 20);
        if (!lim.ok) return bad(429, "report limit per day exceeded (20)", {}, request);

        let body = null;
        try { body = await request.json(); } catch { body = null; }
        if (!body) return bad(400, "bad json", {}, request);

        let id = String(body.id || "").trim();
        if (!id && body?.text) {
          id = canonicalId(body.mode || "trivia", body.text || "");
        }
        if (!id) return bad(400, "id required", {}, request);

        const exists0 = (await kv.get(`public:${id}`)) || (await kv.get(`pending:${id}`));
        if (!exists0) {
          const ali = await resolveAlias(kv, id);
          if (ali) id = ali;
        }

        const day = todayJST();
        const onceKey = `reported:${day}:${fp}:${id}`;
        const already = await kv.get(onceKey);
        if (already) return bad(409, "already reported today", {}, request);
        await kv.put(onceKey, "1", { expirationTtl: 60 * 60 * 24 * 2 });

        await ensureMeta(kv, {
          id,
          text: body.text || "",
          penName: body.penName || null,
          mode: body.mode || "trivia",
          bucket: body.bucket ?? 0,
          source: body.source || "unknown",
        });

        const reportsToday = await incReport(kv, id);
        return json({ ok: true, id, reportsToday }, 200, NO_STORE, request);
      }

      // --- ranking today ---
      if (pathLower === "/api/ranking/today" && request.method === "GET") {
        const mode = normMode(url.searchParams.get("mode"));
        const bucket = normBucket(url.searchParams.get("bucket"));
        const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || "3")));

        const items = await getRankingToday(kv, { mode, bucket, limit });
        return json({ ok: true, items }, 200, NO_STORE, request);
      }

      // --- ranking today (ALL buckets) ---
      if (pathLower === "/api/ranking/today_all" && request.method === "GET") {
        const mode = normMode(url.searchParams.get("mode"));
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || "3")));
        const day = todayJST();

        const key = rankKeyTodayAll(day, mode);
        const list = await kvGetJSON(kv, key);
        if (!Array.isArray(list)) return json({ ok: true, day, items: [] }, 200, NO_STORE, request);

        const rows = [];
        for (const x of list) {
          const likes = await getMergedLikeToday(kv, {
            id: x.id,
            mode,
            bucket: x.bucket ?? 0,
            text: x.text,
          }, day);

          rows.push({
            id: canonicalId(mode, x.text || ""),
            mode,
            text: x.text,
            penName: x.penName || null,
            source: x.source || null,
            likes,
          });
        }

        const items = mergeCanonicalItems(rows)
          .sort((a, b) => Number(b.likes || 0) - Number(a.likes || 0))
          .slice(0, limit)
          .map(x => ({
            id: x.id,
            text: x.text,
            penName: x.penName || null,
            source: x.source || null,
            likes: Number(x.likes || 0),
          }));

        return json({ ok: true, day, items }, 200, NO_STORE, request);
      }

      // --- ranking total ---
      if (pathLower === "/api/ranking/total" && request.method === "GET") {
        const mode = normMode(url.searchParams.get("mode"));
        const bucket = normBucket(url.searchParams.get("bucket"));
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || "10")));

        const items = await getRankingTotal(kv, { mode, bucket, limit }, env);
        return json({ ok: true, items, hofThreshold: getHofThreshold(env) }, 200, NO_STORE, request);
      }

      // --- ranking total (ALL buckets) ---
      if (pathLower === "/api/ranking/total_all" && request.method === "GET") {
        const mode = normMode(url.searchParams.get("mode"));
        const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || "200")));

        const items = await getRankingTotalAllBuckets(kv, { mode, limit }, env);
        return json({ ok: true, items, hofThreshold: getHofThreshold(env) }, 200, NO_STORE, request);
      }

      // --- hall of fame ---
      if (pathLower === "/api/hof" && request.method === "GET") {
        const mode = normMode(url.searchParams.get("mode"));
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || "200")));

        const scope = String(url.searchParams.get("scope") || "all").trim().toLowerCase();
        const bucketParam = url.searchParams.get("bucket");

        if (scope === "bucket") {
          const bucket = normBucket(bucketParam);
          const items = await getHallOfFame(kv, { mode, bucket, limit }, env);
          return json({ ok: true, items, hofThreshold: getHofThreshold(env), scope: "bucket", bucket }, 200, NO_STORE, request);
        } else {
          const items = await getHallOfFameAll(kv, { mode, limit }, env);
          return json({ ok: true, items, hofThreshold: getHofThreshold(env), scope: "all" }, 200, NO_STORE, request);
        }
      }

      // --- hall daily snapshot (public) ---
      if (pathLower === "/api/hof_daily" && request.method === "GET") {
        const day = String(url.searchParams.get("day") || todayJST()).trim();
        const snapshot = await getHallDailySnapshot(kv, env, day);
        if (!snapshot) {
          return json({
            ok: true,
            type: "hall_of_fame_daily",
            day,
            generatedAt: null,
            hofThreshold: getHofThreshold(env),
            count: 0,
            items: [],
            note: "snapshot_not_found",
            build: BUILD
          }, 200, NO_STORE, request);
        }
        return json(snapshot, 200, NO_STORE, request);
      }

      // ===================================================
      // admin: 初期ネタ取り込み
      // ===================================================
      const isImportSeedPath =
        pathLower === "/api/import_seed" ||
        pathLower === "/api/importseed" ||
        pathLower === "/api/seed/import" ||
        pathLower === "/api/seed" ||
        pathLower === "/api/admin/import_seed" ||
        pathLower === "/api/admin/importseed" ||
        pathLower === "/api/admin/seed/import" ||
        pathLower === "/api/admin/seed";

      if (isImportSeedPath && request.method === "POST") {
        if (!isAdmin(request, env)) return bad(403, "forbidden", {}, request);

        const body = await request.json().catch(() => null);
        if (!body) return bad(400, "bad json", {}, request);

        const items =
          Array.isArray(body.items) ? body.items :
          Array.isArray(body.seed) ? body.seed :
          Array.isArray(body.data) ? body.data :
          [];

        const capped = items.slice(0, 200);

        const r = await adminImportSeed(kv, capped);
        return json({ ok: true, ...r, build: BUILD }, 200, NO_STORE, request);
      }

      if (pathLower === "/api/admin/check" && request.method === "GET") {
        if (!isAdmin(request, env)) return bad(403, "forbidden", {}, request);
        return json({ ok: true, admin: true, build: BUILD }, 200, NO_STORE, request);
      }

      if (pathLower === "/api/admin/reindex_public" && request.method === "POST") {
        if (!isAdmin(request, env)) return bad(403, "forbidden", {}, request);

        const body = await request.json().catch(() => null);

        const modeQ = body?.mode ?? null;
        const bucketQ = body?.bucket ?? null;
        const max = Number(body?.max ?? 20000);

        const mode = (modeQ == null || modeQ === "" || modeQ === "all") ? null : normMode(modeQ);
        const bucket = (bucketQ == null || bucketQ === "" || bucketQ === "all") ? null : normBucket(bucketQ);

        const r = await adminReindexPublic(kv, { mode, bucket, max: Math.max(1000, Math.min(50000, max)) });
        return json({ ...r, build: BUILD }, 200, NO_STORE, request);
      }

      if (pathLower === "/api/admin/reindex_latest" && request.method === "POST") {
        if (!isAdmin(request, env)) return bad(403, "forbidden", {}, request);

        const body = await request.json().catch(() => null);

        const modeQ = body?.mode ?? null;
        const max = Number(body?.max ?? 20000);
        const maxKeep = Number(body?.maxKeep ?? 2000);

        const mode =
          (modeQ == null || modeQ === "" || modeQ === "all")
            ? null
            : normMode(modeQ);

        const r = await adminReindexLatest(kv, {
          mode,
          max: Math.max(1000, Math.min(50000, max)),
          maxKeep: Math.max(100, Math.min(5000, maxKeep)),
        });

        return json({ ...r, build: BUILD }, 200, NO_STORE, request);
      }

      // --- hall daily snapshot build (admin) ---
      if (pathLower === "/api/admin/hof_daily_build" && request.method === "POST") {
        if (!isAdmin(request, env)) return bad(403, "forbidden", {}, request);

        const body = await request.json().catch(() => ({}));
        const day = String(body?.day || todayJST()).trim();
        const limitPerMode = Math.max(50, Math.min(500, Number(body?.limitPerMode ?? 200)));
        const topAll = Math.max(20, Math.min(500, Number(body?.topAll ?? 200)));

        const snapshot = await buildHallDailySnapshot(kv, env, { day, limitPerMode, topAll });
        return json(snapshot, 200, NO_STORE, request);
      }

      // --- hall daily snapshot get (admin) ---
      if (pathLower === "/api/admin/hof_daily" && request.method === "GET") {
        if (!isAdmin(request, env)) return bad(403, "forbidden", {}, request);

        const day = String(url.searchParams.get("day") || todayJST()).trim();
        const snapshot = await getHallDailySnapshot(kv, env, day);
        if (!snapshot) {
          return bad(404, "hall_daily not found", { day, build: BUILD }, request);
        }
        return json(snapshot, 200, NO_STORE, request);
      }

      if (pathLower === "/api/admin/all" && request.method === "GET") {
        if (!isAdmin(request, env)) return bad(403, "forbidden", {}, request);

        const scope = normScope(url.searchParams.get("scope"));
        const limit = Math.max(1, Math.min(5000, Number(url.searchParams.get("limit") || "2000")));

        const out = [];

        if (scope === "public" || scope === "both") {
          const pubs = await adminListPublic(kv, { limit });
          for (const it of pubs) out.push({ ...it, status: "public" });
        }
        if (scope === "pending" || scope === "both") {
          const pens = await adminListPending(kv);
          for (const it of pens) out.push({ ...it, status: "pending" });
        }

        out.sort((a, b) => (b.approvedAt || b.createdAt || 0) - (a.approvedAt || a.createdAt || 0));
        return json({ ok: true, items: out.slice(0, limit), scope, limit }, 200, NO_STORE, request);
      }

      if (pathLower === "/api/admin/list" && request.method === "GET") {
        if (!isAdmin(request, env)) return bad(403, "forbidden", {}, request);

        const modeQ = url.searchParams.get("mode");
        const bucketQ = url.searchParams.get("bucket");
        const limit = Math.max(1, Math.min(5000, Number(url.searchParams.get("limit") || "5000")));

        const mode = (modeQ == null || modeQ === "" || modeQ === "all") ? null : normMode(modeQ);
        const bucket = (bucketQ == null || bucketQ === "" || bucketQ === "all") ? null : normBucket(bucketQ);

        const out = await adminListPublic(kv, { mode, bucket, limit });
        return json({ ok: true, items: out }, 200, NO_STORE, request);
      }

      if (pathLower === "/api/admin/delete" && request.method === "POST") {
        if (!isAdmin(request, env)) return bad(403, "forbidden", {}, request);

        let body = null;
        try { body = await request.json(); } catch { body = null; }
        if (!body) return bad(400, "bad json", {}, request);

        const scope = normScope(body.scope);

        if (body.all === true) {
          const r = await adminDeleteAll(kv, scope);
          return json(r, 200, NO_STORE, request);
        }

        const ids = [];
        if (typeof body.id === "string" && body.id.trim()) ids.push(body.id.trim());
        if (Array.isArray(body.ids)) {
          for (const v of body.ids) {
            const s = String(v || "").trim();
            if (s) ids.push(s);
          }
        }
        if (ids.length === 0) return bad(400, "id(s) required", {}, request);

        const wipeMeta = !!body.wipeMeta;
        const wipeTotals = !!body.wipeTotals;

        const r = await adminDeleteIds(kv, ids, scope, { wipeMeta, wipeTotals });
        return json(r, 200, NO_STORE, request);
      }

      if (pathLower === "/api/admin/pending" && request.method === "GET") {
        if (!isAdmin(request, env)) return bad(403, "forbidden", {}, request);
        const out = await adminListPending(kv);
        return json({ ok: true, items: out }, 200, NO_STORE, request);
      }

      if (isApprovePath(pathRaw) && request.method === "POST") {
        if (!isAdmin(request, env)) return bad(403, "forbidden", {}, request);

        let body = null;
        try { body = await request.json(); } catch { body = null; }
        if (!body) return bad(400, "bad json", {}, request);

        const ids = pickIdsFromBody(body);
        if (!ids.length) return bad(400, "id required", {}, request);

        const CONC = 8;

        async function runWithLimit(list, worker, limit){
          const results = new Array(list.length);
          let i = 0;

          const runners = Array.from({ length: Math.min(limit, list.length) }, async () => {
            while (true){
              const idx = i++;
              if (idx >= list.length) break;
              try{
                results[idx] = await worker(list[idx], idx);
              }catch(e){
                results[idx] = { ok:false, id:list[idx], status:500, error:String(e?.message || e) };
              }
            }
          });

          await Promise.all(runners);
          return results;
        }

        const resList = await runWithLimit(ids, async (id) => {
          const r = await adminApproveOne(kv, id);
          if (!r?.ok) return { ok:false, id, status:r?.status || 500, error:r?.error || "approve failed", diag:r?.diag || null };
          return { ok:true, id };
        }, CONC);

        const approved = resList.filter(x => x && x.ok).map(x => x.id);
        const failed   = resList.filter(x => x && !x.ok).map(x => ({
          id: x.id,
          status: x.status || 500,
          error: x.error || "approve failed",
          diag: x.diag || null
        }));

        return json({
          ok: true,
          ids,
          approved,
          failed,
          note: failed.length ? "partial_fail" : "all_ok"
        }, 200, NO_STORE, request);
      }

      if (pathLower === "/api/admin/reject" && request.method === "POST") {
        if (!isAdmin(request, env)) return bad(403, "forbidden", {}, request);

        let body = null;
        try { body = await request.json(); } catch { body = null; }
        if (!body) return bad(400, "bad json", {}, request);

        const ids = pickIdsFromBody(body);
        if (!ids.length) return bad(400, "id required", {}, request);

        for (const id of ids) {
          await adminRejectOne(kv, id);
        }

        return json({ ok: true, ids }, 200, NO_STORE, request);
      }

      if (pathLower === "/api/pending" && request.method === "GET") {
        if (!isAdmin(request, env)) return bad(403, "forbidden", {}, request);
        const out = await adminListPending(kv);
        return json({ ok: true, items: out }, 200, NO_STORE, request);
      }

      if (pathLower === "/api/reject" && request.method === "POST") {
        if (!isAdmin(request, env)) return bad(403, "forbidden", {}, request);

        let body = null;
        try { body = await request.json(); } catch { body = null; }
        if (!body) return bad(400, "bad json", {}, request);

        const ids = pickIdsFromBody(body);
        if (!ids.length) return bad(400, "id required", {}, request);

        const id = ids[0];
        const r = await adminRejectOne(kv, id);
        return json({ ok: true, id: r.id }, 200, NO_STORE, request);
      }

      return bad(404, "not found", { path: pathRaw, method: request.method, build: BUILD }, request);

    } catch (e) {
      return bad(
        500,
        "internal_error",
        { detail: String(e?.stack || e?.message || e), build: BUILD },
        request
      );
    }
  }
};

// # END
