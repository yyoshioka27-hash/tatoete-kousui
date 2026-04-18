const DEFAULT_LIMIT = 400; // >= 50
const MAX_LIMIT = 1000;
const INDEX_KEY_ALL = "idx:public";
const INDEX_KEY_LATEST_PREFIX = "idx:public_latest:";
const SNAPSHOT_TTL_MS = 20 * 1000;
const NG_PHRASES = ["共通テスト"];
let snapshotCache = {
  at: 0,
  items: null,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/public") {
      return handlePublic(request, env, { latestOnly: false });
    }

    if (path === "/api/public_latest") {
      return handlePublic(request, env, { latestOnly: true });
    }

    if (path === "/api/admin/reindex" || path === "/api/admin/reindex_public") {
      return handleReindex(env);
    }

    if (path === "/api/admin/debug_item") {
      return handleDebugItem(request, env);
    }

    return json({ error: "not_found" }, 404);
  },
};

function getKv(env) {
  return env.PUBLIC_KV || env.KV || env.DB || null;
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

async function loadPublicItems(kv) {
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

  const fromIndexRaw = await kv.get(INDEX_KEY_ALL, "json");
  const fromIndex = Array.isArray(fromIndexRaw) ? fromIndexRaw.map(normalizeItem).filter(Boolean) : [];
  const fromScanRaw = await scanPrefix(kv, "public:");
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
  snapshotCache = { at: now, items };
  return {
    items,
    cacheHit: false,
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

async function handlePublic(request, env, { latestOnly }) {
  const kv = getKv(env);
  if (!kv) return json({ error: "kv_not_bound" }, 500);

  const url = new URL(request.url);
  const limit = parseLimit(url, latestOnly ? 100 : DEFAULT_LIMIT);
  const mode = url.searchParams.get("mode");
  const bucket = url.searchParams.get("bucket");

  const debugId = String(url.searchParams.get("debug_id") || "").trim();
  const debugText = canonicalText(url.searchParams.get("debug_text") || "");

  const loaded = await loadPublicItems(kv);
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
      `source(index=${loaded.fromIndex},scan=${loaded.fromScan},scanOnly=${loaded.mergedOnlyScan},cacheHit=${loaded.cacheHit}) ` +
      `target_in_loaded=${hasTarget(loaded.items)} target_in_filtered=${hasTarget(filtered)} target_in_result=${hasTarget(result)} ` +
      `sort=${latestOnly ? "createdAt_desc" : "likes_createdAt_desc"}`
  );

  return json({
    ok: true,
    items: result,
    count: result.length,
    total: filtered.length,
    latestCount: latestOnly ? result.length : 0,
    debug: {
      mode: normalizeMode(mode) || "all",
      bucket: normalizeBucket(bucket),
      source: {
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
  });
}

async function handleDebugItem(request, env) {
  const kv = getKv(env);
  if (!kv) return json({ error: "kv_not_bound" }, 500);

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

  const loaded = await loadPublicItems(kv);
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
  });
}

async function handleReindex(env) {
  const kv = getKv(env);
  if (!kv) return json({ error: "kv_not_bound" }, 500);

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
  return json({ ok: true, scanned: scannedRaw.length, wrote: grouped.size + 1, total: items.length });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
