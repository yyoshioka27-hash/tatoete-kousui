const DEFAULT_LIMIT = 400; // >= 50
const MAX_LIMIT = 1000;
const INDEX_KEY_ALL = "idx:public";

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
    id: String(raw.id || raw.key || `${Date.now()}_${text.slice(0, 16)}`),
    text,
    mode: normalizeMode(raw.mode),
    bucket: normalizeBucket(raw.bucket),
    likes: Number(raw.likes ?? raw.totalLikes ?? raw.likesToday ?? 0) || 0,
    createdAt: Number(raw.createdAt ?? raw.ts ?? raw.time ?? 0) || 0,
    ...raw,
  };
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

  // mode/bucket フィルタを一時緩和:
  // - クエリ指定があっても mode/bucket が欠損したアイテムは除外しない
  // - 明示的に不一致のものだけ除外
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
  const fromIndex = await kv.get(INDEX_KEY_ALL, "json");
  if (Array.isArray(fromIndex) && fromIndex.length) {
    return fromIndex.map(normalizeItem).filter(Boolean);
  }

  const list = await scanPrefix(kv, "public:");
  return list.map(normalizeItem).filter(Boolean);
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

  let items = await loadPublicItems(kv);
  const beforeFilter = items.length;
  items = relaxedFilter(items, mode, bucket).sort(compareByCreatedAtDesc);

  const result = items.slice(0, limit);
  console.log(
    `[debug] ${latestOnly ? "/api/public_latest" : "/api/public"} count=${result.length} beforeFilter=${beforeFilter} afterFilter=${items.length} limit=${limit} sort=createdAt_desc`
  );

  return json({ ok: true, items: result, count: result.length, total: items.length });
}

async function handleReindex(env) {
  const kv = getKv(env);
  if (!kv) return json({ error: "kv_not_bound" }, 500);

  const scannedRaw = await scanPrefix(kv, "public:");
  const items = scannedRaw.map(normalizeItem).filter(Boolean).sort(comparePublic);

  await kv.put(INDEX_KEY_ALL, JSON.stringify(items));

  // 既存運用との互換のため mode/bucket別 index も再作成
  const grouped = new Map();
  for (const it of items) {
    const m = normalizeMode(it.mode) || "unknown";
    const b = normalizeBucket(it.bucket);
    const key = `idx:public:${m}:${b ?? "unknown"}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(it);
  }

  await Promise.all(
    Array.from(grouped.entries()).map(([key, arr]) => kv.put(key, JSON.stringify(arr)))
  );

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
