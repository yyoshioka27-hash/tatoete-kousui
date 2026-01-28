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
    body: JSON.stringify({ mode, bucket, text, penName, from: "web" })
  });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `submit failed ${res.status}`);
  return data;
}

// ✅ public取得：textだけでなく id/penName も保持（ランキング・いいねの表示に使える）
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

  // {id, mode, bucket, text, penName}
  return (data.items || [])
    .map(x => ({
      id: String(x?.id || "").trim() || null,
      text: String(x?.text || "").trim(),
      penName: String(x?.penName || "").trim() || null
    }))
    .filter(x => x.text);
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
    // metaphors.js が生きていれば window.JSON_METAPHORS は残るので “消さない”
    window.JSON_METAPHORS = window.JSON_METAPHORS || [];
  }
}

function getSharedItems(mode, bucket) {
  const m = (mode === "fun" ? "fun" : "trivia");
  const b = window.bucket10(bucket);

  const base = (sharedItems && sharedItems.length)
    ? sharedItems
    : (Array.isArray(window.JSON_METAPHORS)
        ? window.JSON_METAPHORS.map(it => ({
            mode: (it?.mode === "fun" ? "fun" : "trivia"),
            bucket: window.bucket10(Number(it?.bucket)),
            text: String(it?.text || "").trim()
          })).filter(x => x.text)
        : []);

  return base.filter(x => x.mode === m && x.bucket === b);
}

// ==============================
// ✅ 共有ネタ（Cloudflare Workers /api/public）
// - public を抽選候補へ混ぜる
// - mode×bucket のキャッシュ
// ==============================
const publicCache = new Map(); // key: "mode_bucket" => [{id,text,penName},...]

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
    warmPublicCache(mode, bucket).then(() => {
      try { render(); } catch {}
    }).catch(() => {});
    return [];
  }

  const arr = publicCache.get(k) || [];
  return arr
    .map(x => ({ text: String(x.text||"").trim(), publicId: x.id || null, penName: x.penName || null }))
    .filter(x => x.text);
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
    m: { text: null, publicId: null, penName: null },
    d: { text: null, publicId: null, penName: null },
    e: { text: null, publicId: null, penName: null }
  }
};

const $ = (id) => document.getElementById(id);

// =========================
// 👍（ローカル）人気度：出やすくする（従来維持）
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

  // ① 旧来：metaphors.js の NETA / NETA_TRIVIA
  const base1 = (mode === "trivia"
    ? (window.NETA_TRIVIA?.[bucket] ?? [])
    : (window.NETA?.[bucket] ?? []));
  const out1 = base1.map(x => String(x || "").trim()).filter(Boolean);
  if (out1.length) return out1;

  // ② フォールバック：window.JSON_METAPHORS（metaphors.js / metaphors.json 互換）
  const m = (mode === "fun" ? "fun" : "trivia");
  const b = window.bucket10(bucket);
  const out2 = (Array.isArray(window.JSON_METAPHORS) ? window.JSON_METAPHORS : [])
    .map(it => ({
      mode: (it?.mode === "fun" ? "fun" : "trivia"),
      bucket: window.bucket10(Number(it?.bucket)),
      text: String(it?.text || "").trim()
    }))
    .filter(x => x.text && x.mode === m && x.bucket === b)
    .map(x => x.text);

  return out2;
}

function buildCandidatePool(mode, bucket) {
  const b = window.bucket10(bucket);

  const baseTexts = getBaseTexts(mode, b).map(t => ({ text: t, publicId: null, penName: null }));
  const shared = getSharedItems(mode, b).map(x => ({ text: x.text, publicId: null, penName: null }));
  const pub    = getPublicItems(mode, b);

  const out = [];
  const seen = new Set();
  for (const item of [...baseTexts, ...shared, ...pub]) {
    if (!item?.text) continue;
    if (seen.has(item.text)) continue;
    seen.add(item.text);
    out.push(item);
  }

  // ③ それでも空なら「データなし」ではなく暫定文を出す（UIが死なない）
  if (!out.length) {
    out.push({ text: "（ネタ準備中：metaphors.js / metaphors.json を確認）", publicId: null, penName: null });
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
    return like + 1;
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
// - publicId がある時は Worker /api/like も叩く（Aの仕様に合わせる）
// =========================
async function likeOnServer(publicId){
  const res = await fetch(`${API_BASE}/api/like`, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ id: publicId })
  });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `like failed ${res.status}`);
  return data;
}

function updateLikeUI(slot) {
  const phraseObj = state.currentPhrases[slot];
  const phrase = phraseObj?.text;

  const countEl = document.getElementById(`likeCount_${slot}`);
  const badgeEl = document.getElementById(`badge_${slot}`);
  const btnEl = document.getElementById(`like_${slot}`);

  if (!btnEl) return;

  if (!phrase) {
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
    // ① ローカルの出やすさ（従来維持）
    incrementLike(phrase);
    updateLikeUI(slot);

    // ② 公開ネタならサーバーにも今日のいいねを加算（失敗してもローカルは残す）
    if (phraseObj?.publicId) {
      try { await likeOnServer(phraseObj.publicId); } catch {}
    }

    renderRanking(); // 今日ランキング更新
    render();        // 出やすさ反映
  };
}

// =========================
// 「このネタを削除」：常に非表示
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
// 今日ランキング（ボタン直下）
// - 「今の確率」＝朝昼夜のうち最大のバケット
// - mode も反映
// =========================
function getCurrentMainBucket(){
  if (!state?.pops) return null;
  const arr = [state.pops.m, state.pops.d, state.pops.e].filter(v => v != null);
  if (!arr.length) return null;
  return window.bucket10(Math.max(...arr));
}

async function fetchRankingToday(mode, bucket, limit=3){
  const params = new URLSearchParams();
  params.set("mode", mode === "fun" ? "fun" : "trivia");
  params.set("bucket", String(window.bucket10(bucket)));
  params.set("limit", String(limit));
  const res = await fetch(`${API_BASE}/api/ranking/today?${params.toString()}`, { method:"GET" });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `ranking failed ${res.status}`);
  return data.items || [];
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
      <div class="muted" style="margin-bottom:8px;">※今日(JST)のいいね数で集計（公開ネタのみ）</div>
      <div class="muted">読み込み中…</div>
    </div>
  `;

  try{
    const items = await fetchRankingToday(mode, bucket, 3);
    if (!items.length) {
      wrap.querySelector(".muted").textContent = "まだランキングがありません（今日の👍が0件）";
      return;
    }

    const rows = items.map((it, idx) => {
      const pen = it.penName ? ` <span class="muted">(${escapeHtml(it.penName)})</span>` : "";
      return `
        <div style="padding:10px 0; border-top:1px solid rgba(15,23,42,0.10);">
          <div style="font-weight:800;">${idx+1}位：${escapeHtml(it.text)}${pen}</div>
          <div class="muted">今日の👍：${Number(it.likes||0)}</div>
        </div>
      `;
    }).join("");

    wrap.innerHTML = `
      <div class="card" style="margin:0; padding:14px; background:rgba(255,255,255,0.72); border:1px solid rgba(15,23,42,0.08); border-radius:14px;">
        <div style="font-weight:900; font-size:16px; margin-bottom:6px;">今日のランキング TOP3（${bucket}% / ${mode==="fun"?"お笑い":"雑学"}）</div>
        <div class="muted" style="margin-bottom:8px;">※今日(JST)のいいね数で集計（公開ネタのみ）</div>
        ${rows}
      </div>
    `;
  } catch (e) {
    wrap.querySelector(".muted").textContent = `ランキング取得に失敗：${e?.message || e}`;
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// =========================
// render
// =========================
function render() {
  const hintEl = document.getElementById("popHint");
  const sourceTag = document.getElementById("sourceTag");
  const tzTag = document.getElementById("tzTag");

  if (sourceTag) sourceTag.textContent = state.source;
  if (tzTag) tzTag.textContent = state.tz ? `TZ: ${state.tz}` : "TZ: --";

  const setSlot = (slotKey, value, label) => {
    const popEl = document.getElementById(`pop_${slotKey}`);
    const metaEl = document.getElementById(`meta_${slotKey}`);

    if (value == null) {
      if (popEl) popEl.textContent = "--%";
      if (metaEl) metaEl.textContent = "データなし";

      setIcon(slotKey, null);

      state.currentPhrases[slotKey] = { text: null, publicId: null, penName: null };
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

    state.currentPhrases[slotKey] = { text: picked.text, publicId: picked.publicId || null, penName: picked.penName || null };
    updateLikeUI(slotKey);
    updateDeleteUI(slotKey);

    try { applyTheme(rounded); } catch {}

    return { value: rounded };
  };

  if (!state.pops) {
    if (hintEl) hintEl.textContent = "地点を選ぶと自動取得します";
    renderEmpty();
    renderRanking(); // 空でも整合
    return;
  }

  if (hintEl) hintEl.textContent = state.placeLabel ? `地点：${state.placeLabel}` : "地点：--";

  setSlot("m", state.pops.m, "朝");
  setSlot("d", state.pops.d, "昼");
  setSlot("e", state.pops.e, "夜");

  renderRanking();
}

function renderEmpty() {
  ["m","d","e"].forEach(k => {
    const popEl = document.getElementById(`pop_${k}`);
    const metaEl = document.getElementById(`meta_${k}`);

    if (popEl) popEl.textContent = "--%";
    if (metaEl) metaEl.textContent = "データなし";

    setIcon(k, null);

    state.currentPhrases[k] = { text: null, publicId: null, penName: null };
    updateLikeUI(k);
    updateDeleteUI(k);
  });
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

// ✅ ふわっと
document.getElementById("refresh").onclick = () => {
  const area = document.getElementById("refreshArea");
  if (area) {
    area.classList.remove("floatAnim");
    void area.offsetWidth; // reflow
    area.classList.add("floatAnim");
  }
  render();
};

// ==============================
// ✅ ネタ追加（承認待ちへ送信）
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
      await submitToPending(mode, bucket, text, penName || null);

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
render();

loadSharedJSON().then(() => {
  render();
});

// ==============================
// Theme (Gradient) by precipitation
// ==============================
function themeFromPercent(p){
  if (p <= 10)  return { bg1:"#fff7d6", bg2:"#ffffff", accent:"#f59e0b" };
  if (p <= 30)  return { bg1:"#e8f6ff", bg2:"#ffffff", accent:"#38bdf8" };
  if (p <= 50)  return { bg1:"#eaf0ff", bg2:"#f8fafc", accent:"#60a5fa" };
  if (p <= 70)  return { bg1:"#dbeafe", bg2:"#eff6ff", accent:"#2563eb" };
  if (p <= 90)  return { bg1:"#c7d2fe", bg2:"#e0e7ff", accent:"#1d4ed8" };
  return          { bg1:"#e9d5ff", bg2:"#0b1220", accent:"#a855f7" };
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
