// script.js
// ✅ API_BASE（あなたのWorkersのURL）
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

// =========================
// ✅ いいね演出用CSS（任意）
// =========================
(function injectLikeFxCSS(){
  const id = "likeFxCSS_v1";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .like-btn-pop { transform: scale(1.0); transition: transform 120ms ease; }
    .like-btn-pop:active { transform: scale(1.12); }
    .rank-card { border:1px solid rgba(15,23,42,.12); border-radius:16px; padding:12px; margin:12px 0; background:rgba(255,255,255,.9); }
    .rank-title { font-weight:700; margin-bottom:8px; }
    .rank-item { display:flex; gap:10px; align-items:flex-start; padding:8px 0; border-top:1px dashed rgba(15,23,42,.12); }
    .rank-item:first-child{ border-top:none; }
    .badge { width:28px; height:28px; border-radius:999px; display:flex; align-items:center; justify-content:center; font-weight:700; border:1px solid rgba(15,23,42,.12); }
    .pen { color:#475569; font-size:12px; }
    .toast { position:fixed; left:50%; bottom:16px; transform:translateX(-50%); background:rgba(15,23,42,.92); color:#fff; padding:10px 14px; border-radius:999px; font-size:13px; z-index:9999; }
  `;
  document.head.appendChild(style);
})();

// ----------------------
// 状態
// ----------------------
const state = {
  mode: "trivia",   // trivia | fun
  bucket: 30,       // 0..100
  items: [],
  loading: false,
  lastError: "",
};

// ----------------------
// API
// ----------------------
async function apiGET(path){
  const res = await fetch(`${API_BASE}${path}`, { method:"GET" });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `GET ${path} failed ${res.status}`);
  return data;
}

async function apiPOST(path, body){
  const res = await fetch(`${API_BASE}${path}`, {
    method:"POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `POST ${path} failed ${res.status}`);
  return data;
}

async function fetchPublic(){
  state.loading = true;
  state.lastError = "";
  scheduleRender();

  const q = new URLSearchParams();
  q.set("mode", state.mode);
  q.set("bucket", String(state.bucket));
  q.set("limit", "80");

  try{
    const data = await apiGET(`/api/public?${q.toString()}`);
    state.items = data.items || [];
  }catch(e){
    state.lastError = String(e?.message || e);
  }finally{
    state.loading = false;
    scheduleRender();
  }
}

async function submitPending(text, penName){
  return apiPOST(`/api/submit`, {
    mode: state.mode,
    bucket: state.bucket,
    text,
    penName,
    from: "web"
  });
}

async function likeItem(id){
  return apiPOST(`/api/like`, {
    mode: state.mode,
    bucket: state.bucket,
    id
  });
}

async function fetchTodayRanking(){
  const q = new URLSearchParams();
  q.set("mode", state.mode);
  q.set("bucket", String(state.bucket));
  return apiGET(`/api/ranking/today?${q.toString()}`);
}

// ----------------------
// UI helper
// ----------------------
function $(sel){ return document.querySelector(sel); }

function toast(msg){
  try{
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(()=>t.remove(), 2200);
  }catch{}
}

// ✅ script.js 側で必要DOMを自動生成（HTMLを壊しても復旧できる）
function ensureUI(){
  // ルート
  let root = $("#app");
  if(!root){
    root = document.createElement("div");
    root.id = "app";
    root.style.maxWidth = "720px";
    root.style.margin = "0 auto";
    root.style.padding = "16px";
    document.body.appendChild(root);
  }

  if(!$("#controls")){
    const box = document.createElement("div");
    box.id = "controls";
    box.innerHTML = `
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:12px;">
        <select id="modeSel">
          <option value="trivia">雑学</option>
          <option value="fun">お笑い</option>
        </select>
        <select id="bucketSel">
          ${Array.from({length:11}).map((_,i)=>`<option value="${i*10}">${i*10}%</option>`).join("")}
        </select>

        <button id="reloadBtn">更新</button>
      </div>

      <div class="rank-card" id="rankCard" style="display:none;">
        <div class="rank-title" id="rankTitle">今日のいいね TOP3</div>
        <div id="rankBody"></div>
      </div>

      <div style="border:1px solid rgba(15,23,42,.12); border-radius:16px; padding:12px; margin-bottom:12px; background:rgba(255,255,255,.9);">
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <input id="penNameInput" placeholder="ペンネーム（必須・重複不可）" maxlength="20" style="flex:1; min-width:220px;" />
          <input id="textInput" placeholder="例えを追加（180文字まで）" maxlength="180" style="flex:3; min-width:280px;" />
          <button id="submitBtn">投稿（承認待ち）</button>
        </div>
        <div id="submitHint" style="color:#64748b; font-size:12px; margin-top:6px;">
          ※投稿は1日10個まで／いいねは1日10回まで（超えると弾かれます）
        </div>
      </div>

      <div id="status" style="color:#64748b; font-size:13px; margin:6px 0;"></div>
      <div id="list"></div>
    `;
    root.appendChild(box);

    // 初期値反映
    $("#modeSel").value = state.mode;
    $("#bucketSel").value = String(state.bucket);

    // events
    $("#modeSel").addEventListener("change", async (e)=>{
      state.mode = e.target.value === "fun" ? "fun" : "trivia";
      await refreshAll();
    });

    $("#bucketSel").addEventListener("change", async (e)=>{
      state.bucket = Number(e.target.value);
      await refreshAll();
    });

    $("#reloadBtn").addEventListener("click", async ()=>{
      await refreshAll();
    });

    $("#submitBtn").addEventListener("click", async ()=>{
      const text = ($("#textInput").value || "").trim();
      const penName = ($("#penNameInput").value || "").trim();
      if(!penName){ toast("ペンネームを入力してね"); return; }
      if(!text){ toast("本文が空だよ"); return; }

      $("#submitBtn").disabled = true;
      try{
        await submitPending(text, penName);
        $("#textInput").value = "";
        toast("送信しました（承認待ち）");
      }catch(e){
        toast(String(e?.message || e));
      }finally{
        $("#submitBtn").disabled = false;
      }
    });
  }
}

async function refreshAll(){
  await fetchPublic();
  await renderRanking();
  scheduleRender();
}

async function renderRanking(){
  try{
    const data = await fetchTodayRanking();
    const card = $("#rankCard");
    const body = $("#rankBody");
    const title = $("#rankTitle");
    if(!card || !body || !title) return;

    const top3 = data.top3 || [];
    title.textContent = `今日のいいね TOP3（${data.dateKey}）`;

    if(top3.length === 0){
      card.style.display = "none";
      return;
    }
    card.style.display = "block";
    body.innerHTML = top3.map((x, i)=>{
      const medal = ["🥇","🥈","🥉"][i] || "🏅";
      const likes = Number(x.likes||0);
      const pen = (x.penName||"").replace(/</g,"&lt;").replace(/>/g,"&gt;");
      const text = (x.text||"").replace(/</g,"&lt;").replace(/>/g,"&gt;");
      return `
        <div class="rank-item">
          <div class="badge">${medal}</div>
          <div style="flex:1;">
            <div style="font-weight:600; line-height:1.3;">${text}</div>
            <div class="pen">by ${pen} ／ 👍 ${likes}</div>
          </div>
        </div>
      `;
    }).join("");
  }catch{
    // ランキング失敗は致命じゃないので無視
  }
}

function render(){
  ensureUI();

  const status = $("#status");
  const list = $("#list");

  if(status){
    status.textContent = state.loading ? "読み込み中…" : (state.lastError ? `エラー: ${state.lastError}` : `表示: ${state.mode} / ${state.bucket}%`);
  }
  if(!list) return;

  const items = state.items || [];
  if(items.length === 0){
    list.innerHTML = `<div style="color:#64748b; padding:8px;">まだ公開ネタがないよ</div>`;
    return;
  }

  list.innerHTML = items.map(item => {
    const id = String(item.id || "");
    const text = String(item.text || "").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const pen = String(item.penName || "").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const likes = Number(item.likes || 0);

    return `
      <div style="border:1px solid rgba(15,23,42,.12); border-radius:16px; padding:12px; margin:10px 0; background:rgba(255,255,255,.9);">
        <div style="font-size:16px; line-height:1.35; font-weight:600;">${text}</div>
        <div style="display:flex; gap:10px; align-items:center; justify-content:space-between; margin-top:8px;">
          <div style="color:#64748b; font-size:12px;">by ${pen || "（不明）"}</div>
          <button class="like-btn-pop" data-like="${id}">👍 ${likes}</button>
        </div>
      </div>
    `;
  }).join("");

  // like events
  list.querySelectorAll("[data-like]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.getAttribute("data-like");
      btn.disabled = true;
      try{
        const data = await likeItem(id);
        // ローカル反映
        const idx = state.items.findIndex(x=>String(x.id)===String(id));
        if(idx>=0) state.items[idx].likes = data.likes;
        scheduleRender();
        // ランキングも更新
        await renderRanking();
      }catch(e){
        toast(String(e?.message || e));
      }finally{
        btn.disabled = false;
      }
    });
  });
}

// 起動
(async function boot(){
  ensureUI();
  await refreshAll();
  scheduleRender();
})();

// END
