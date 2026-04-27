const DEFAULT_LIMIT = 400; // >= 50
const MAX_LIMIT = 1000;
const INDEX_KEY_ALL = "idx:public";
const INDEX_KEY_LATEST_PREFIX = "idx:public_latest:";
const SNAPSHOT_TTL_MS = 20 * 1000;
const RANK_CACHE_TTL_MS = 15 * 1000;
const HOF_THRESHOLD_DEFAULT = 20;
const HOF_DAILY_KEY_PREFIX = "snapshot:hof_daily:";
const USAGE_SEEN_PREFIX = "usage:seen:";
const USAGE_COUNT_PREFIX = "usage:count:";
const USAGE_METRIC_PREFIX = "usage:metric:";
const NG_PHRASES = ["共通テスト"];
let snapshotCache = {
  at: 0,
  items: null,
};
let rankingCache = {
  at: 0,
  day: "",
  byMode: new Map(),
};
let lastKvDebug = null;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const kvStats = createKvStats(path);
    const kv = getTrackedKv(env, kvStats);

    try {
      if (path === "/api/public") {
        return handlePublic(request, env, kv, { latestOnly: false, kvStats });
      }

      if (path === "/api/public_latest") {
        return handlePublic(request, env, kv, { latestOnly: true, kvStats });
      }

      if (path === "/api/health") {
        return handleHealth(request, env, kvStats);
      }

      if (path === "/api/ranking/today" || path === "/api/ranking/today_all") {
        return handleRankingToday(request, env, kv, { kvStats });
      }

      if (path === "/api/ranking/total") {
        return handleRankingTotal(request, env, kv, { kvStats });
      }

      if (path === "/api/hof_daily") {
        return handleHofDaily(request, env, kv, { kvStats, requireAdmin: false });
      }

      if (path === "/api/hof") {
        return handleHof(request, env, kv, { kvStats });
      }

      if (path === "/api/admin/hof_daily") {
        return handleHofDaily(request, env, kv, { kvStats, requireAdmin: true });
      }

      if (path === "/api/admin/hof_daily_build" && request.method === "POST") {
        return handleHofDailyBuild(request, env, kv, { kvStats });
      }

      if (path === "/api/usage/ping" && request.method === "POST") {
        return handleUsagePing(request, env, kv, { kvStats });
      }

      if ((path === "/api/admin/usage" || path === "/api/admin/stats") && request.method === "GET") {
        return handleAdminUsage(request, env, kv, { kvStats });
      }

      if (path === "/api/admin/reindex" || path === "/api/admin/reindex_public") {
        return handleReindex(kv, { kvStats });
      }

      if (path === "/api/admin/debug_item") {
        return handleDebugItem(request, kv, { kvStats });
      }

      if (path === "/api/admin/kv_debug") {
        return handleKvDebug(request, env, kvStats);
      }

      if (path === "/api/like" && request.method === "POST") {
        return handleLike(request, env, ctx, kv, { kvStats });
      }

      return json({ error: "not_found" }, 404, kvStats);
    } finally {
      finalizeKvStats(kvStats);
    }
  },
};

function getKv(env) {
  return env.PUBLIC_KV || env.KV || env.DB || null;
}

function createKvStats(pathname) {
  return {
    path: pathname,
    startedAt: Date.now(),
    get: 0,
    put: 0,
    list: 0,
    delete: 0,
  };
}

function getTrackedKv(env, kvStats) {
  const kv = getKv(env);
  if (!kv) return null;
  return {
    get: (...args) => {
      kvStats.get += 1;
      return kv.get(...args);
    },
    put: (...args) => {
      kvStats.put += 1;
      return kv.put(...args);
    },
    list: (...args) => {
      kvStats.list += 1;
      return kv.list(...args);
    },
    delete: (...args) => {
      kvStats.delete += 1;
      return kv.delete(...args);
    },
  };
}

function finalizeKvStats(kvStats) {
  kvStats.finishedAt = Date.now();
  kvStats.elapsedMs = Math.max(0, kvStats.finishedAt - kvStats.startedAt);
  lastKvDebug = {
    ...kvStats,
    total: Number(kvStats.get + kvStats.put + kvStats.list + kvStats.delete),
  };
}

function parseLimit(url, fallback = DEFAULT_LIMIT) {
  const raw = Number(url.searchParams.get("limit"));
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.max(50, Math.floor(raw)), MAX_LIMIT);
}

function normalizeMode(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "fun" || v === "comedy") return "fun";
  if (v === "trivia") return "trivia";
  return "";
}

function normalizeBucket(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n / 10) * 10));
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = String(raw.text || "").trim();
  if (!text) return null;

  return {
    ...raw,
    id: String(raw.id || raw.key || `${Date.now()}_${text.slice(0, 16)}`),
    text,
    mode: normalizeMode(raw.mode),
    bucket: normalizeBucket(raw.bucket),
    likes: Number(raw.likes ?? raw.totalLikes ?? raw.likesToday ?? 0) || 0,
    createdAt: Number(raw.createdAt ?? raw.ts ?? raw.time ?? 0) || 0,
  };
}

function canonicalText(text) {
  return String(text || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeMetaphorText(text) {
  return String(text || "")
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

function makeDedupeKey(mode, bucket, text) {
  const m = normalizeMode(mode) || "trivia";
  const b = normalizeBucket(bucket);
  return `m:${m}|b:${b ?? 0}|t:${normalizeMetaphorText(text)}`;
}

function isNgText(text) {
  const t = String(text || "");
  if (!t) return true;
  return NG_PHRASES.some((ng) => ng && t.includes(ng));
}

function hasMismatchedPercent(text, bucket) {
  try {
    const t = String(text || "");
    const b = Number(bucket);
    if (!Number.isFinite(b)) return false;

    const re = /(\d{1,3})\s*[%％]/g;
    let m;
    while ((m = re.exec(t)) !== null) {
      const p = Number(m[1]);
      if (!Number.isFinite(p)) continue;
      if (p < 0 || p > 100) continue;
      if (p !== b) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function hasHard100PercentMismatch(text, bucket) {
  try {
    const t = String(text || "");
    const b = Number(bucket);
    if (!Number.isFinite(b)) return false;
    if (b === 100) return false;
    return /100\s*(%|％)/.test(t);
  } catch {
    return false;
  }
}

function comparePublic(a, b) {
  const likesA = Number(a?.likes ?? -1);
  const likesB = Number(b?.likes ?? -1);
  const hasLikesA = Number.isFinite(likesA) && likesA >= 0;
  const hasLikesB = Number.isFinite(likesB) && likesB >= 0;

  if (hasLikesA || hasLikesB) {
    if (likesB !== likesA) return likesB - likesA;
  }

  const createdA = Number(a?.createdAt || 0);
  const createdB = Number(b?.createdAt || 0);
  return createdB - createdA;
}

function compareByCreatedAtDesc(a, b) {
  const createdA = Number(a?.createdAt || 0);
  const createdB = Number(b?.createdAt || 0);
  if (createdB !== createdA) return createdB - createdA;

  const likesA = Number(a?.likes ?? 0);
  const likesB = Number(b?.likes ?? 0);
  return likesB - likesA;
}

function relaxedFilter(items, mode, bucket) {
  const m = normalizeMode(mode);
  const b = normalizeBucket(bucket);

  return items.filter((it) => {
    if (m) {
      const itemMode = normalizeMode(it.mode);
      if (itemMode && itemMode !== m) return false;
    }
    if (b !== null) {
      const itemBucket = normalizeBucket(it.bucket);
      if (itemBucket !== null && itemBucket !== b) return false;
    }
    return true;
  });
}

async function loadPublicItems(kv, { mode = "", bucket = null, latestOnly = false, allowScan = false } = {}) {
  const now = Date.now();
  if (Array.isArray(snapshotCache.items) && now - snapshotCache.at < SNAPSHOT_TTL_MS) {
    return {
      items: snapshotCache.items,
      cacheHit: true,
      fromIndex: snapshotCache.items.length,
      fromScan: 0,
      mergedOnlyScan: 0,
    };
  }

  const normalizedMode = normalizeMode(mode);
  const normalizedBucket = normalizeBucket(bucket);
  let indexKey = INDEX_KEY_ALL;
  if (latestOnly && normalizedMode) {
    indexKey = `${INDEX_KEY_LATEST_PREFIX}${normalizedMode}`;
  } else if (normalizedMode && normalizedBucket !== null) {
    indexKey = `idx:public:${normalizedMode}:${normalizedBucket}`;
  }

  const fromIndexRaw = await kv.get(indexKey, "json");
  const fromIndex = Array.isArray(fromIndexRaw) ? fromIndexRaw.map(normalizeItem).filter(Boolean) : [];
  const fromScanRaw = allowScan ? await scanPrefix(kv, "public:") : [];
  const fromScan = fromScanRaw.map(normalizeItem).filter(Boolean);

  const merged = new Map();
  const add = (it, source) => {
    if (!it) return;
    const key = String(it.id || "").trim() || `t:${canonicalText(it.text)}`;
    if (!merged.has(key)) {
      merged.set(key, it);
      return;
    }
    const cur = merged.get(key);
    if (Number(it.createdAt || 0) > Number(cur.createdAt || 0) || Number(it.likes || 0) > Number(cur.likes || 0)) {
      merged.set(key, { ...cur, ...it });
    } else if (source === "scan") {
      merged.set(key, { ...it, ...cur });
    }
  };

  for (const it of fromIndex) add(it, "index");
  for (const it of fromScan) add(it, "scan");

  const items = Array.from(merged.values());
  if (indexKey === INDEX_KEY_ALL) {
    snapshotCache = { at: now, items };
  }
  return {
    items,
    cacheHit: false,
    indexKey,
    fromIndex: fromIndex.length,
    fromScan: fromScan.length,
    mergedOnlyScan: Math.max(0, items.length - fromIndex.length),
  };
}

async function scanPrefix(kv, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    if (Array.isArray(page?.keys) && page.keys.length) {
      const values = await Promise.all(page.keys.map((k) => kv.get(k.name, "json")));
      for (let i = 0; i < values.length; i++) {
        const value = values[i];
        if (value && typeof value === "object") {
          out.push({ key: page.keys[i].name, ...value });
        }
      }
    }
    cursor = page?.cursor;
    if (!page?.list_complete && !cursor) break;
    if (page?.list_complete) break;
  } while (cursor);
  return out;
}

async function handlePublic(request, env, kv, { latestOnly, kvStats }) {
  if (!kv) return json({ error: "kv_not_bound" }, 500, kvStats);

  const url = new URL(request.url);
  const limit = parseLimit(url, latestOnly ? 100 : DEFAULT_LIMIT);
  const mode = url.searchParams.get("mode");
  const bucket = url.searchParams.get("bucket");

  const debugId = String(url.searchParams.get("debug_id") || "").trim();
  const debugText = canonicalText(url.searchParams.get("debug_text") || "");

  const includeScan = url.searchParams.get("include_scan") === "1";
  const loaded = await loadPublicItems(kv, { mode, bucket, latestOnly, allowScan: includeScan });
  const beforeFilter = loaded.items.length;
  const filtered = relaxedFilter(loaded.items, mode, bucket);
  const sorted = filtered.sort(latestOnly ? compareByCreatedAtDesc : comparePublic);
  const result = sorted.slice(0, limit);

  const hasTarget = (arr) => {
    if (!debugId && !debugText) return "n/a";
    return arr.some((it) => {
      const hitById = debugId && String(it?.id || "").trim() === debugId;
      const hitByText = debugText && canonicalText(it?.text) === debugText;
      return hitById || hitByText;
    });
  };

  console.log(
    `[debug] ${latestOnly ? "/api/public_latest" : "/api/public"} ` +
      `mode=${normalizeMode(mode) || "all"} bucket=${normalizeBucket(bucket) ?? "all"} ` +
      `API返却件数=${result.length} beforeFilter=${beforeFilter} フィルタ後件数=${filtered.length} ` +
      `latest表示件数=${latestOnly ? result.length : 0} limit=${limit} ` +
      `source(indexKey=${loaded.indexKey || INDEX_KEY_ALL},index=${loaded.fromIndex},scan=${loaded.fromScan},scanOnly=${loaded.mergedOnlyScan},cacheHit=${loaded.cacheHit}) ` +
      `target_in_loaded=${hasTarget(loaded.items)} target_in_filtered=${hasTarget(filtered)} target_in_result=${hasTarget(result)} ` +
      `sort=${latestOnly ? "createdAt_desc" : "likes_createdAt_desc"}`
  );

  return json({
    ok: true,
    day: getJstDay(),
    hofThreshold: getHofThreshold(env),
    items: result,
    count: result.length,
    total: filtered.length,
    latestCount: latestOnly ? result.length : 0,
    debug: {
      mode: normalizeMode(mode) || "all",
      bucket: normalizeBucket(bucket),
      source: {
        indexKey: loaded.indexKey || INDEX_KEY_ALL,
        index: loaded.fromIndex,
        scan: loaded.fromScan,
        scanOnly: loaded.mergedOnlyScan,
        cacheHit: loaded.cacheHit,
      },
      target: {
        loaded: hasTarget(loaded.items),
        filtered: hasTarget(filtered),
        result: hasTarget(result),
      },
    },
  }, 200, kvStats);
}

async function handleDebugItem(request, kv, { kvStats }) {
  if (!kv) return json({ error: "kv_not_bound" }, 500, kvStats);

  const url = new URL(request.url);
  const id = String(url.searchParams.get("id") || "").trim();
  const mode = normalizeMode(url.searchParams.get("mode"));
  const bucket = normalizeBucket(url.searchParams.get("bucket"));
  const textParam = String(url.searchParams.get("text") || "").trim();

  if (!id && !textParam) {
    return json({ error: "id_or_text_required" }, 400);
  }

  const publicRecord = id ? await kv.get(`public:${id}`, "json") : null;
  const indexAllRaw = await kv.get(INDEX_KEY_ALL, "json");
  const modeBucketRaw = mode && bucket !== null ? await kv.get(`idx:public:${mode}:${bucket}`, "json") : null;
  const latestRaw = mode ? await kv.get(`${INDEX_KEY_LATEST_PREFIX}${mode}`, "json") : null;

  const allIndex = Array.isArray(indexAllRaw) ? indexAllRaw.map(normalizeItem).filter(Boolean) : [];
  const modeBucketIndex = Array.isArray(modeBucketRaw) ? modeBucketRaw.map(normalizeItem).filter(Boolean) : [];
  const latestIndex = Array.isArray(latestRaw) ? latestRaw.map(normalizeItem).filter(Boolean) : [];

  const normalizedPublic = normalizeItem(publicRecord ? { key: `public:${id}`, ...publicRecord } : null);
  const byId = (it) => String(it?.id || "").trim() === id;
  const byText = (it) => textParam && canonicalText(it?.text) === canonicalText(textParam);
  const matcher = (it) => (id && byId(it)) || byText(it);

  const hitIndexAll = allIndex.find(matcher) || null;
  const hitModeBucket = modeBucketIndex.find(matcher) || null;
  const hitLatest = latestIndex.find(matcher) || null;

  const sourceItem = normalizedPublic || hitIndexAll || hitModeBucket || hitLatest;
  const resolvedMode = mode || normalizeMode(sourceItem?.mode);
  const resolvedBucket = bucket !== null ? bucket : normalizeBucket(sourceItem?.bucket);

  const loaded = await loadPublicItems(kv, { mode: resolvedMode, bucket: resolvedBucket, allowScan: true });
  const filtered = relaxedFilter(loaded.items, resolvedMode, resolvedBucket);

  const targetInFiltered = filtered.find((it) => (id ? byId(it) : byText(it)));

  const reasons = [];
  if (!normalizedPublic) reasons.push("not_found_in_public_key");
  if (mode && bucket !== null && !hitModeBucket) reasons.push("missing_in_mode_bucket_index");
  if (mode && !hitLatest) reasons.push("missing_in_public_latest_index");

  const target = sourceItem || targetInFiltered;
  const ng = isNgText(target?.text || "");
  const mismatchPercent = hasMismatchedPercent(target?.text || "", resolvedBucket);
  const mismatchHard100 = hasHard100PercentMismatch(target?.text || "", resolvedBucket);
  if (ng) reasons.push("excluded_by_ng_phrase");
  if (mismatchPercent) reasons.push("excluded_by_percent_mismatch");
  if (mismatchHard100) reasons.push("excluded_by_hard_100_percent_mismatch");

  const dedupeKey = target ? makeDedupeKey(resolvedMode, resolvedBucket, target.text) : null;
  const dedupeConflicts = target
    ? filtered.filter((it) => makeDedupeKey(resolvedMode, resolvedBucket, it.text) === dedupeKey).map((it) => ({ id: it.id, text: it.text }))
    : [];

  if (target && dedupeConflicts.length > 1) reasons.push("dedupe_conflict_same_canonical_text");

  return json({
    ok: true,
    query: { id, text: textParam || null, mode: resolvedMode || null, bucket: resolvedBucket },
    checks: {
      publicKey: {
        exists: !!normalizedPublic,
        key: id ? `public:${id}` : null,
      },
      indexPublicAll: {
        exists: !!hitIndexAll,
        total: allIndex.length,
      },
      indexModeBucket: {
        key: resolvedMode && resolvedBucket !== null ? `idx:public:${resolvedMode}:${resolvedBucket}` : null,
        exists: !!hitModeBucket,
        total: modeBucketIndex.length,
      },
      indexPublicLatest: {
        key: resolvedMode ? `${INDEX_KEY_LATEST_PREFIX}${resolvedMode}` : null,
        exists: !!hitLatest,
        total: latestIndex.length,
      },
      appCandidate: {
        consideredMode: resolvedMode,
        consideredBucket: resolvedBucket,
        inLoaded: loaded.items.some((it) => (id ? byId(it) : byText(it))),
        inModeBucketFiltered: !!targetInFiltered,
        excludedBy: reasons,
      },
      normalizeAndDedupe: {
        canonicalText: target ? normalizeMetaphorText(target.text) : null,
        dedupeKey,
        conflictCount: dedupeConflicts.length,
        conflicts: dedupeConflicts.slice(0, 10),
      },
    },
    item: target || null,
    sample: {
      modeBucketTop10: filtered.slice(0, 10).map((it) => ({ id: it.id, text: it.text, likes: Number(it.likes || 0), createdAt: Number(it.createdAt || 0) })),
    },
  }, 200, kvStats);
}

async function handleReindex(kv, { kvStats }) {
  if (!kv) return json({ error: "kv_not_bound" }, 500, kvStats);

  const scannedRaw = await scanPrefix(kv, "public:");
  const items = scannedRaw.map(normalizeItem).filter(Boolean).sort(comparePublic);

  await kv.put(INDEX_KEY_ALL, JSON.stringify(items));
  snapshotCache = { at: 0, items: null };

  const grouped = new Map();
  const latestByMode = new Map();

  for (const it of items) {
    const m = normalizeMode(it.mode) || "unknown";
    const b = normalizeBucket(it.bucket);
    const key = `idx:public:${m}:${b ?? "unknown"}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(it);

    if (!latestByMode.has(m)) latestByMode.set(m, []);
    latestByMode.get(m).push(it);
  }

  for (const [m, arr] of latestByMode.entries()) {
    arr.sort(compareByCreatedAtDesc);
    grouped.set(`${INDEX_KEY_LATEST_PREFIX}${m}`, arr);
  }

  await Promise.all(Array.from(grouped.entries()).map(([key, arr]) => kv.put(key, JSON.stringify(arr))));

  console.log(`[debug] /api/admin/reindex scanned=${scannedRaw.length} normalized=${items.length} wrote=${grouped.size + 1}`);
  return json({ ok: true, scanned: scannedRaw.length, wrote: grouped.size + 1, total: items.length }, 200, kvStats);
}

async function handleKvDebug(request, env, kvStats) {
  const adminKey = String(env.ADMIN_KEY || "").trim();
  if (adminKey) {
    const reqKey = String(request.headers.get("x-admin-key") || "").trim();
    if (!reqKey || reqKey !== adminKey) {
      return json({ ok: false, error: "forbidden" }, 403, kvStats);
    }
  }

  return json({
    ok: true,
    now: {
      path: kvStats.path,
      get: kvStats.get,
      put: kvStats.put,
      list: kvStats.list,
      delete: kvStats.delete,
      elapsedMs: Math.max(0, Date.now() - kvStats.startedAt),
    },
    last: lastKvDebug,
  }, 200, kvStats);
}

function getHofThreshold(env) {
  const n = Number(env?.HOF_THRESHOLD || HOF_THRESHOLD_DEFAULT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : HOF_THRESHOLD_DEFAULT;
}

function ensureAdmin(request, env) {
  const adminKey = String(env.ADMIN_KEY || "").trim();
  if (!adminKey) return true;
  const reqKey = String(request.headers.get("x-admin-key") || "").trim();
  return !!reqKey && reqKey === adminKey;
}

function parseDayOrToday(value, now = Date.now()) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return getJstDay(now);
}

function getModeParam(url) {
  const m = normalizeMode(url.searchParams.get("mode"));
  return m || "trivia";
}

function normalizeRankingEntry(raw, modeHint = "") {
  const it = normalizeItem(raw);
  if (!it) return null;
  return {
    id: String(it.id || "").trim(),
    text: String(it.text || "").trim(),
    mode: normalizeMode(it.mode) || normalizeMode(modeHint) || "trivia",
    bucket: normalizeBucket(it.bucket) ?? 0,
    likes: Number(it.likesToday ?? it.likes ?? 0) || 0,
    totalLikes: Number(it.likes ?? it.totalLikes ?? 0) || 0,
    penName: it.penName ? String(it.penName).trim() : null,
    hof: !!it.hof,
    createdAt: Number(it.createdAt || 0),
  };
}

function mergeRankingById(items) {
  const map = new Map();
  for (const raw of Array.isArray(items) ? items : []) {
    const it = normalizeRankingEntry(raw);
    if (!it || !it.id || !it.text) continue;
    const cur = map.get(it.id);
    if (!cur) {
      map.set(it.id, it);
      continue;
    }
    cur.likes = Math.max(Number(cur.likes || 0), Number(it.likes || 0));
    cur.totalLikes = Math.max(Number(cur.totalLikes || 0), Number(it.totalLikes || 0));
    cur.createdAt = Math.max(Number(cur.createdAt || 0), Number(it.createdAt || 0));
    cur.hof = !!cur.hof || !!it.hof;
    if (!cur.penName && it.penName) cur.penName = it.penName;
    if (it.text.length > cur.text.length) cur.text = it.text;
  }
  return Array.from(map.values());
}

async function getAllPublicItemsForRanking(kv, { includeScan = false } = {}) {
  const loaded = await loadPublicItems(kv, {
    latestOnly: false,
    allowScan: includeScan,
  });
  return mergeRankingById(loaded.items);
}

async function getRankingSnapshot(kv, { mode, day }) {
  const now = Date.now();
  if (rankingCache.day === day && now - rankingCache.at < RANK_CACHE_TTL_MS && rankingCache.byMode.has(mode)) {
    return rankingCache.byMode.get(mode);
  }

  const all = await getAllPublicItemsForRanking(kv, { includeScan: false });
  const filtered = all.filter((it) => (normalizeMode(it.mode) || "trivia") === mode);
  const today = filtered
    .filter((it) => Number(it.likes || 0) > 0)
    .sort((a, b) => Number(b.likes || 0) - Number(a.likes || 0) || Number(b.createdAt || 0) - Number(a.createdAt || 0));
  const total = filtered
    .filter((it) => Number(it.totalLikes || 0) > 0)
    .sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0) || Number(b.createdAt || 0) - Number(a.createdAt || 0));

  if (rankingCache.day !== day) {
    rankingCache = { at: now, day, byMode: new Map() };
  } else {
    rankingCache.at = now;
  }

  const snap = { today, total };
  rankingCache.byMode.set(mode, snap);
  return snap;
}

async function handleHealth(_request, env, kvStats) {
  return json({
    ok: true,
    BUILD: String(env.BUILD || "worker-local"),
    now: Date.now(),
    hofThreshold: getHofThreshold(env),
  }, 200, kvStats);
}

async function handleRankingToday(request, env, kv, { kvStats }) {
  if (!kv) return json({ ok: false, error: "kv_not_bound" }, 500, kvStats);

  const url = new URL(request.url);
  const mode = getModeParam(url);
  const limit = parseLimit(url, 20);
  const day = parseDayOrToday(url.searchParams.get("day"));
  const path = url.pathname;
  await incrementUsageMetric(kv, getJstDay(), "ranking_fetches");

  if (path === "/api/ranking/today_all") {
    const all = await getAllPublicItemsForRanking(kv, { includeScan: false });
    const items = all
      .filter((it) => (normalizeMode(it.mode) || "trivia") === mode)
      .filter((it) => Number(it.likes || 0) > 0)
      .sort((a, b) => Number(b.likes || 0) - Number(a.likes || 0) || Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, limit);
    return json({ ok: true, mode, day, items, count: items.length, hofThreshold: getHofThreshold(env) }, 200, kvStats);
  }

  const bucket = normalizeBucket(url.searchParams.get("bucket"));
  const snapshot = await getRankingSnapshot(kv, { mode, day });
  let items = snapshot.today;
  if (bucket !== null) {
    items = items.filter((it) => normalizeBucket(it.bucket) === bucket);
  }
  items = items.slice(0, limit);
  return json({
    ok: true,
    mode,
    bucket,
    day,
    items,
    count: items.length,
    hofThreshold: getHofThreshold(env),
  }, 200, kvStats);
}

async function handleRankingTotal(request, env, kv, { kvStats }) {
  if (!kv) return json({ ok: false, error: "kv_not_bound" }, 500, kvStats);
  const url = new URL(request.url);
  const mode = getModeParam(url);
  const bucket = normalizeBucket(url.searchParams.get("bucket"));
  const limit = parseLimit(url, 20);
  const day = getJstDay();
  await incrementUsageMetric(kv, day, "ranking_fetches");
  const snapshot = await getRankingSnapshot(kv, { mode, day });
  let items = snapshot.total;
  if (bucket !== null) {
    items = items.filter((it) => normalizeBucket(it.bucket) === bucket);
  }
  items = items.slice(0, limit).map((it) => ({
    ...it,
    hof: !!it.hof || Number(it.totalLikes || 0) >= getHofThreshold(env),
  }));
  return json({ ok: true, mode, bucket, items, count: items.length, hofThreshold: getHofThreshold(env) }, 200, kvStats);
}

async function handleHof(request, env, kv, { kvStats }) {
  if (!kv) return json({ ok: false, error: "kv_not_bound" }, 500, kvStats);
  const url = new URL(request.url);
  const mode = getModeParam(url);
  const limit = parseLimit(url, 50);
  const threshold = getHofThreshold(env);
  const all = await getAllPublicItemsForRanking(kv, { includeScan: false });
  const items = all
    .filter((it) => (normalizeMode(it.mode) || "trivia") === mode)
    .filter((it) => Number(it.totalLikes || 0) >= threshold)
    .sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0) || Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, limit)
    .map((it) => ({ ...it, hof: true }));
  return json({
    ok: true,
    mode,
    count: items.length,
    items,
    hofThreshold: threshold,
  }, 200, kvStats);
}

function hofKeyByDay(day) {
  return `${HOF_DAILY_KEY_PREFIX}${day}`;
}

async function buildHofDailySnapshot(kv, env, day) {
  const threshold = getHofThreshold(env);
  const all = await getAllPublicItemsForRanking(kv, { includeScan: false });
  const hofItems = all
    .filter((it) => Number(it.totalLikes || 0) >= threshold)
    .sort((a, b) => Number(b.totalLikes || 0) - Number(a.totalLikes || 0) || Number(b.createdAt || 0) - Number(a.createdAt || 0));

  const payload = {
    ok: true,
    day,
    type: "hall_of_fame_daily_snapshot",
    generatedAt: Date.now(),
    hofThreshold: threshold,
    count: hofItems.length,
    items: hofItems,
  };
  await kv.put(hofKeyByDay(day), JSON.stringify(payload));
  return payload;
}

async function handleHofDaily(request, env, kv, { kvStats, requireAdmin }) {
  if (!kv) return json({ ok: false, error: "kv_not_bound" }, 500, kvStats);
  if (requireAdmin && !ensureAdmin(request, env)) {
    return json({ ok: false, error: "forbidden" }, 403, kvStats);
  }
  const url = new URL(request.url);
  const day = parseDayOrToday(url.searchParams.get("day"));
  const existing = await kv.get(hofKeyByDay(day), "json");
  if (existing && typeof existing === "object") {
    return json({ ...existing, ok: true }, 200, kvStats);
  }
  if (requireAdmin) {
    return json({
      ok: true,
      day,
      type: "hall_of_fame_daily_snapshot_missing",
      snapshotExists: false,
      count: 0,
      hofThreshold: getHofThreshold(env),
    }, 200, kvStats);
  }
  const auto = await buildHofDailySnapshot(kv, env, day);
  return json(auto, 200, kvStats);
}

async function handleHofDailyBuild(request, env, kv, { kvStats }) {
  if (!kv) return json({ ok: false, error: "kv_not_bound" }, 500, kvStats);
  if (!ensureAdmin(request, env)) return json({ ok: false, error: "forbidden" }, 403, kvStats);
  const body = await request.json().catch(() => ({}));
  const day = parseDayOrToday(body?.day || new URL(request.url).searchParams.get("day"));
  const built = await buildHofDailySnapshot(kv, env, day);
  return json({
    ok: true,
    built: true,
    day,
    count: Number(built.count || 0),
    generatedAt: built.generatedAt,
    hofThreshold: built.hofThreshold,
  }, 200, kvStats);
}

async function handleUsagePing(request, _env, kv, { kvStats }) {
  if (!kv) return json({ ok: false, error: "kv_not_bound" }, 500, kvStats);
  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const day = getJstDay();
  const reason = normalizeUsageReason(url.searchParams.get("r") || body?.reason || "");
  const deviceId =
    String(url.searchParams.get("d") || "").trim() ||
    String(body?.deviceId || "").trim() ||
    "anonymous";
  const normalizedDevice = deviceId.replace(/[^\w\-:.]/g, "_").slice(0, 128) || "anonymous";
  const seenKey = `${USAGE_SEEN_PREFIX}${day}:${normalizedDevice}`;
  const countKey = `${USAGE_COUNT_PREFIX}${day}`;

  if (reason === "weather_search") {
    await incrementUsageMetric(kv, day, "weather_search_count");
  }

  const seen = await kv.get(seenKey, "text");
  if (!seen) {
    const current = Number(await kv.get(countKey, "text")) || 0;
    const next = current + 1;
    await Promise.all([
      kv.put(seenKey, "1", { expirationTtl: 60 * 60 * 24 * 3 }),
      kv.put(countKey, String(next), { expirationTtl: 60 * 60 * 24 * 8 }),
    ]);
    return json({ ok: true, day, unique: true, dau: next, reason }, 200, kvStats);
  }
  const dau = Number(await kv.get(countKey, "text")) || 0;
  return json({ ok: true, day, unique: false, dau, reason }, 200, kvStats);
}

function usageMetricKey(day, metric) {
  return `${USAGE_METRIC_PREFIX}${day}:${metric}`;
}

function normalizeUsageReason(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "weather_search" || v === "wx_search") return "weather_search";
  if (v === "dau_ping" || v === "wx_ok") return "dau_ping";
  return "other";
}

async function incrementUsageMetric(kv, day, metric, delta = 1) {
  const key = usageMetricKey(day, metric);
  const current = Number(await kv.get(key, "text")) || 0;
  const next = Math.max(0, current + Number(delta || 0));
  await kv.put(key, String(next), { expirationTtl: 60 * 60 * 24 * 8 });
  return next;
}

async function readUsageMetric(kv, day, metric) {
  return Number(await kv.get(usageMetricKey(day, metric), "text")) || 0;
}

async function handleAdminUsage(request, env, kv, { kvStats }) {
  if (!kv) return json({ ok: false, error: "kv_not_bound" }, 500, kvStats);
  if (!ensureAdmin(request, env)) return json({ ok: false, error: "forbidden" }, 403, kvStats);

  const url = new URL(request.url);
  const day = parseDayOrToday(url.searchParams.get("day"));
  const countKey = `${USAGE_COUNT_PREFIX}${day}`;
  const [dauToday, weatherSearchCount, weatherSearchesLegacy, likeCount, rankingFetches] = await Promise.all([
    Number(await kv.get(countKey, "text")) || 0,
    readUsageMetric(kv, day, "weather_search_count"),
    readUsageMetric(kv, day, "weather_searches"),
    readUsageMetric(kv, day, "likes"),
    readUsageMetric(kv, day, "ranking_fetches"),
  ]);
  const weatherSearches = Math.max(weatherSearchCount, weatherSearchesLegacy);

  return json({
    ok: true,
    day,
    dauToday,
    users: dauToday,
    weatherSearches,
    weatherSearchCount: weatherSearches,
    likes: likeCount,
    likeCount,
    rankingFetches,
    usage: {
      day,
      users: dauToday,
      weatherSearches,
      likes: likeCount,
      rankingFetches,
    },
  }, 200, kvStats);
}

function json(data, status = 200, kvStats = null) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
  if (kvStats) {
    headers["x-kv-get"] = String(kvStats.get || 0);
    headers["x-kv-put"] = String(kvStats.put || 0);
    headers["x-kv-list"] = String(kvStats.list || 0);
    headers["x-kv-delete"] = String(kvStats.delete || 0);
    headers["x-kv-total"] = String((kvStats.get || 0) + (kvStats.put || 0) + (kvStats.list || 0) + (kvStats.delete || 0));
  }
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

function getJstDay(ts = Date.now()) {
  const jstMs = ts + 9 * 60 * 60 * 1000;
  return new Date(jstMs).toISOString().slice(0, 10);
}

function normalizeClientId(request, body) {
  const raw =
    String(body?.clientId || "").trim() ||
    String(request.headers.get("x-client-id") || "").trim() ||
    "anonymous";
  return raw.replace(/[^\w\-:.]/g, "_").slice(0, 128) || "anonymous";
}

function resolveLikeTarget(body) {
  const itemId = String(body?.id || body?.itemId || "").trim();
  const text = String(body?.text || "").trim();
  const mode = normalizeMode(body?.mode) || "trivia";
  const bucket = normalizeBucket(body?.bucket) ?? 0;
  if (!itemId || !text) return null;
  return { itemId, text, mode, bucket };
}

async function handleLike(request, env, ctx, kv, { kvStats }) {
  if (!kv) return json({ ok: false, error: "kv_not_bound" }, 500, kvStats);

  const body = await request.json().catch(() => null);
  const target = resolveLikeTarget(body);
  if (!target) return json({ ok: false, error: "invalid_like_payload" }, 400);

  const day = getJstDay();
  const clientId = normalizeClientId(request, body);
  const dedupeKey = `like:${day}:${clientId}:${target.itemId}`;
  const already = await kv.get(dedupeKey, "text");
  if (already) {
    const existing = (await kv.get(`public:${target.itemId}`, "json")) || {};
    const totalLikes = Number(existing.likes || existing.totalLikes || 0);
    return json({
      ok: true,
      liked: false,
      itemId: target.itemId,
      displayedLikeCount: totalLikes,
      totalLikeCount: totalLikes,
      totalLikes,
      todayLikeCount: Number(existing.likesToday || 0),
      likesToday: Number(existing.likesToday || 0),
      hofThreshold: Number(env.HOF_THRESHOLD || 20),
    }, 200, kvStats);
  }

  const now = Date.now();
  const publicKey = `public:${target.itemId}`;
  let nextLikes = 1;
  let nextLikesToday = 1;
  let wrote = false;

  for (let attempt = 0; attempt < 3; attempt++) {
    const current = (await kv.get(publicKey, "json")) || {};
    const prevLikes = Number(current.likes || current.totalLikes || 0);
    const prevLikesToday = Number(current.likesToday || 0);
    nextLikes = prevLikes + 1;
    nextLikesToday = prevLikesToday + 1;

    const nextItem = {
      ...current,
      id: target.itemId,
      text: current.text || target.text,
      mode: normalizeMode(current.mode) || target.mode,
      bucket: normalizeBucket(current.bucket) ?? target.bucket,
      likes: nextLikes,
      totalLikes: nextLikes,
      likesToday: nextLikesToday,
      updatedAt: now,
    };

    await kv.put(publicKey, JSON.stringify(nextItem));
    const verify = (await kv.get(publicKey, "json")) || {};
    const storedLikes = Number(verify.likes || verify.totalLikes || 0);
    if (storedLikes >= nextLikes) {
      wrote = true;
      break;
    }
  }

  await kv.put(
    dedupeKey,
    JSON.stringify({
      id: target.itemId,
      day,
      clientId,
      at: now,
    }),
    { expirationTtl: 60 * 60 * 24 * 2 }
  );
  if (!wrote) {
    const latest = (await kv.get(publicKey, "json")) || {};
    nextLikes = Number(latest.likes || latest.totalLikes || nextLikes);
    nextLikesToday = Number(latest.likesToday || nextLikesToday);
  }

  snapshotCache = { at: 0, items: null };
  rankingCache.at = 0;
  await incrementUsageMetric(kv, day, "likes");

  ctx.waitUntil(runLikeHeavyTasks(env, target, now).catch((e) => {
    console.log(`[warn] runLikeHeavyTasks failed id=${target.itemId}: ${e?.message || e}`);
  }));

  return json({
    ok: true,
    liked: true,
    itemId: target.itemId,
    displayedLikeCount: nextLikes,
    totalLikeCount: nextLikes,
    totalLikes: nextLikes,
    todayLikeCount: nextLikesToday,
    likesToday: nextLikesToday,
    hofThreshold: Number(env.HOF_THRESHOLD || 20),
  }, 200, kvStats);
}

async function runLikeHeavyTasks(env, target, nowTs) {
  const kv = getKv(env);
  if (!kv) return;

  const day = getJstDay(nowTs);
  const canonicalKey = `agg:canonical:pending:${target.mode}:${target.bucket}:${target.itemId}`;
  const rankingKey = `agg:ranking:pending:${target.mode}:${day}`;
  const hofKey = `agg:hof:pending:${target.mode}:${day}`;

  const [canonicalExists, rankingExists, hofExists] = await Promise.all([
    kv.get(canonicalKey, "text"),
    kv.get(rankingKey, "text"),
    kv.get(hofKey, "text"),
  ]);

  const tasks = [];

  if (!canonicalExists) {
    tasks.push(kv.put(canonicalKey, JSON.stringify({
      id: target.itemId,
      text: target.text,
      mode: target.mode,
      bucket: target.bucket,
      at: nowTs,
    })));
  }

  if (!rankingExists) {
    tasks.push(kv.put(rankingKey, JSON.stringify({
      id: target.itemId,
      mode: target.mode,
      day,
      at: nowTs,
    })));
  }

  if (!hofExists) {
    tasks.push(kv.put(hofKey, JSON.stringify({
      id: target.itemId,
      mode: target.mode,
      day,
      at: nowTs,
    })));
  }

  if (tasks.length) {
    await Promise.all(tasks);
  }
}
