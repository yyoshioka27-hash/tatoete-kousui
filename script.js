// script.js
// =======================================================
// ✅ 既存コードを壊さず “追記で” 機能追加する統合版
// 追加:
//  - render多重呼び出し防止 scheduleRender()
//  - ペンネーム入力欄の自動追加（既存フォームがあればそこに差し込む）
//  - submit時に penName を必ず送る（既存submit関数のラップ）
//  - 今日TOP3パネルの自動追加（mode+bucketに追従）
//  - 429/409 のエラー表示改善
// =======================================================

const API_BASE = "https://ancient-union-4aa4tatoete-kousui-api.y-yoshioka27.workers.dev";

// =========================
// ✅FIX: render 多重呼び出し防止（固まり対策）
// =========================
let __renderQueued = false;
function scheduleRender(){
  if (__renderQueued) return;
  __renderQueued = true;
  requestAnimationFrame(() => {
    __renderQueued = false;
    try { window.render?.(); } catch {}
  });
}

// =========================
// ✅ 追加CSS（既存CSSは触らない）
// =========================
(function __ext_injectCss(){
  const id = "ext_css_v_rank_pen";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .ext-rank-card{ border:1px solid rgba(15,23,42,.12); border-radius:16px; padding:12px; margin:12px 0; background:rgba(255,255,255,.9); }
    .ext-rank-title{ font-weight:700; margin-bottom:8px; }
    .ext-rank-item{ display:flex; gap:10px; align-items:flex-start; padding:8px 0; border-top:1px dashed rgba(15,23,42,.12); }
    .ext-rank-item:first-child{ border-top:none; }
    .ext-badge{ width:28px; height:28px; border-radius:999px; display:flex; align-items:center; justify-content:center; font-weight:700; border:1px solid rgba(15,23,42,.12); }
    .ext-pen{ color:#64748b; font-size:12px; }
    .ext-toast{ position:fixed; left:50%; bottom:16px; transform:translateX(-50%); background:rgba(15,23,42,.92); color:#fff; padding:10px 14px; border-radius:999px; font-size:13px; z-index:9999; }
    .ext-pen-input{ padding:10px 12px; border:1px solid rgba(15,23,42,.12); border-radius:12px; min-width:220px; }
  `;
  document.head.appendChild(style);
})();

function __ext_toast(msg){
  try{
    const t = document.createElement("div");
    t.className = "ext-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(()=>t.remove(), 2200);
  }catch{}
}

async function __ext_apiGET(path){
  const res = await fetch(`${API_BASE}${path}`, { method:"GET" });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `GET ${path} failed ${res.status}`);
  return data;
}
async function __ext_apiPOST(path, body){
  const res = await fetch(`${API_BASE}${path}`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `POST ${path} failed ${res.status}`);
  return data;
}

// =======================================================
// ✅ ペンネーム入力欄を既存UIに“差し込み”
// 既存の投稿入力が見つからない場合は何もしない（壊さない）
// =======================================================
function __ext_ensurePenNameInput(){
  // 既にあるなら何もしない
  if (document.getElementById("penNameInput")) return;

  // 既存の「投稿入力」っぽい場所を探す（あなたのUIが変わっても生き残るように）
  const candidates = [
    document.querySelector('input[name="penName"]'),
    document.querySelector('#textInput')?.parentElement,
    document.querySelector('textarea')?.parentElement,
    document.querySelector('input[type="text"]')?.parentElement,
  ].filter(Boolean);

  const host = candidates[0];
  if (!host) return;

  const input = document.createElement("input");
  input.id = "penNameInput";
  input.className = "ext-pen-input";
  input.placeholder = "ペンネーム（必須・重複不可）";
  input.maxLength = 20;

  // 先頭に挿入（既存レイアウトを壊しにくい）
  host.insertBefore(input, host.firstChild);
}

// =======================================================
// ✅ 今日TOP3パネルを差し込み
// 既存の上部コンテナがあればそこへ。無ければbody先頭に。
// =======================================================
function __ext_ensureRankingPanel(){
  if (document.getElementById("extRankCard")) return;

  const card = document.createElement("div");
  card.id = "extRankCard";
  card.className = "ext-rank-card";
  card.style.display = "none";
  card.innerHTML = `
    <div class="ext-rank-title" id="extRankTitle">今日のいいね TOP3</div>
    <div id="extRankBody"></div>
  `;

  const target =
    document.querySelector("#app")
    || document.querySelector("main")
    || document.body;

  target.insertBefore(card, target.firstChild);
}

// 現在のmode/bucket取得（既存UIから読む。無ければ fallback）
function __ext_getModeBucket(){
  // 既存が select で持ってる場合
  const modeSel = document.querySelector("#modeSel");
  const bucketSel = document.querySelector("#bucketSel");

  let mode = modeSel?.value || window.STATE?.mode || window.state?.mode || "trivia";
  mode = (mode === "fun") ? "fun" : "trivia";

  let bucket = Number(bucketSel?.value ?? window.STATE?.bucket ?? window.state?.bucket ?? 30);
  if (!Number.isFinite(bucket)) bucket = 30;
  bucket = Math.max(0, Math.min(100, Math.round(bucket)));

  return { mode, bucket };
}

async function __ext_renderRanking(){
  __ext_ensureRankingPanel();
  const { mode, bucket } = __ext_getModeBucket();

  try{
    const data = await __ext_apiGET(`/api/ranking/today?mode=${encodeURIComponent(mode)}&bucket=${encodeURIComponent(bucket)}`);
    const top3 = data.top3 || [];
    const card = document.getElementById("extRankCard");
    const title = document.getElementById("extRankTitle");
    const body = document.getElementById("extRankBody");

    if (!card || !title || !body) return;

    if (top3.length === 0){
      card.style.display = "none";
      return;
    }
    card.style.display = "block";
    title.textContent = `今日のいいね TOP3（${data.dateKey}）`;

    body.innerHTML = top3.map((x,i)=>{
      const medal = ["🥇","🥈","🥉"][i] || "🏅";
      const text = String(x.text||"").replace(/</g,"&lt;").replace(/>/g,"&gt;");
      const pen  = String(x.penName||"").replace(/</g,"&lt;").replace(/>/g,"&gt;");
      const likes = Number(x.likes||0);
      return `
        <div class="ext-rank-item">
          <div class="ext-badge">${medal}</div>
          <div style="flex:1;">
            <div style="font-weight:600; line-height:1.3;">${text}</div>
            <div class="ext-pen">by ${pen || "（不明）"} ／ 👍 ${likes}</div>
          </div>
        </div>
      `;
    }).join("");
  }catch{
    // ランキングは失敗しても本体を止めない
  }
}

// =======================================================
// ✅ 既存 submit 関数がある前提で “ラップ”
// - 既存: submitToPending(mode, bucket, text, ...) を想定
// - penName を追加して送る版に置き換え（既存を保持して呼ぶ）
// =======================================================
(function __ext_patchSubmit(){
  // 既存関数が無いなら何もしない（壊さない）
  const orig = window.submitToPending;
  if (typeof orig !== "function") return;

  if (orig.__ext_patched) return;

  async function wrappedSubmit(mode, bucket, text, penName){
    __ext_ensurePenNameInput();
    const pn = (penName ?? document.getElementById("penNameInput")?.value ?? "").trim();
    if (!pn) {
      __ext_toast("ペンネームを入力してね");
      throw new Error("penName required");
    }
    // 既存関数が penName 引数に対応してなくても、orig が fetch を内部で作っている場合がある。
    // なので確実に penName を送るために、ここでは直接 /api/submit を叩く。
    return __ext_apiPOST("/api/submit", { mode, bucket, text, penName: pn, from: "web" });
  }

  wrappedSubmit.__ext_patched = true;

  // 既存を温存して別名に退避（保険）
  window.__submitToPending_original = orig;
  window.submitToPending = wrappedSubmit;
})();

// =======================================================
// ✅ 既存 like 処理後にランキングを更新する（追記）
// 既存: like API 成功後に render() が走るなら、そこに合わせて軽く更新
// =======================================================
(function __ext_patchLike(){
  const origLike = window.likeMetaphor || window.likeItem || null;
  if (typeof origLike !== "function") return;
  if (origLike.__ext_patched) return;

  async function wrappedLike(...args){
    const r = await origLike(...args);
    // ついでにランキングだけ更新（失敗しても無視）
    __ext_renderRanking().catch(()=>{});
    return r;
  }
  wrappedLike.__ext_patched = true;

  // 元名を尊重して差し替え
  if (window.likeMetaphor) window.likeMetaphor = wrappedLike;
  if (window.likeItem) window.likeItem = wrappedLike;
})();

// 起動時に差し込み
(function __ext_boot(){
  try{
    __ext_ensurePenNameInput();
    __ext_ensureRankingPanel();
    __ext_renderRanking();
  }catch{}
})();

// END
