<!-- admin.html -->
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>管理（承認待ち）</title>
  <style>
    :root{ --line:rgba(15,23,42,.12); --sub:#64748b; }
    body{ font-family: system-ui, -apple-system; margin:0; padding:16px; }
    .card{ border:1px solid var(--line); border-radius:16px; padding:12px; margin:12px 0; }
    input{ width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid var(--line); border-radius:12px; }
    button{ padding:10px 12px; border-radius:12px; border:1px solid var(--line); background:#0f172a; color:#fff; cursor:pointer; }
    .row{ display:flex; gap:10px; flex-wrap:wrap; align-items:end; }
    .muted{ color:var(--sub); font-size:13px; }
    .item{ border-top:1px dashed var(--line); padding-top:10px; margin-top:10px; }
    .item:first-child{ border-top:none; padding-top:0; margin-top:0; }
  </style>
</head>
<body>
  <h2>承認待ち 管理</h2>

  <div class="card">
    <div class="row">
      <div style="flex:1; min-width:260px;">
        <div class="muted">ADMIN_KEY</div>
        <input id="key" placeholder="x-admin-key を入力" />
      </div>
      <div style="flex:2; min-width:360px;">
        <div class="muted">API_BASE</div>
        <input id="api" value="https://ancient-union-4aa4tatoete-kousui-api.y-yoshioka27.workers.dev" />
      </div>
      <div>
        <button id="load">一覧取得</button>
      </div>
    </div>
    <div id="msg" class="muted" style="margin-top:10px;"></div>
  </div>

  <div class="card">
    <div style="font-weight:700;">承認待ち一覧</div>
    <div id="list" class="muted" style="margin-top:8px;">未取得</div>
  </div>

<script>
  const $ = (id)=>document.getElementById(id);
  const esc = (s)=>String(s||"").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  async function adminGET(path){
    const API = $("api").value.trim();
    const key = $("key").value.trim();
    const res = await fetch(`${API}${path}`, { headers: { "x-admin-key": key }});
    const data = await res.json().catch(()=>null);
    if(!res.ok || !data?.ok) throw new Error(data?.error || `GET failed ${res.status}`);
    return data;
  }
  async function adminPOST(path, body){
    const API = $("api").value.trim();
    const key = $("key").value.trim();
    const res = await fetch(`${API}${path}`, {
      method:"POST",
      headers:{ "Content-Type":"application/json", "x-admin-key": key },
      body: JSON.stringify(body||{})
    });
    const data = await res.json().catch(()=>null);
    if(!res.ok || !data?.ok) throw new Error(data?.error || `POST failed ${res.status}`);
    return data;
  }

  function render(items){
    if(!items.length){
      $("list").innerHTML = "承認待ちは0件";
      return;
    }
    $("list").innerHTML = items.map(x=>`
      <div class="item">
        <div style="font-weight:700; color:#0f172a;">${esc(x.text)}</div>
        <div class="muted">mode=${esc(x.mode)} / bucket=${esc(x.bucket)} / pen=${esc(x.penName||"")}</div>
        <div class="row" style="margin-top:8px;">
          <button data-a="${esc(x.id)}">承認</button>
          <button data-r="${esc(x.id)}" style="background:#ef4444;">却下</button>
          <span class="muted">${esc(x.id)}</span>
        </div>
      </div>
    `).join("");

    document.querySelectorAll("[data-a]").forEach(b=>{
      b.onclick = async ()=>{
        b.disabled = true;
        try{ await adminPOST("/api/admin/approve", { id: b.getAttribute("data-a") }); await load(); }
        catch(e){ $("msg").textContent = "エラー: " + e.message; }
        finally{ b.disabled = false; }
      };
    });
    document.querySelectorAll("[data-r]").forEach(b=>{
      b.onclick = async ()=>{
        b.disabled = true;
        try{ await adminPOST("/api/admin/reject", { id: b.getAttribute("data-r") }); await load(); }
        catch(e){ $("msg").textContent = "エラー: " + e.message; }
        finally{ b.disabled = false; }
      };
    });
  }

  async function load(){
    $("msg").textContent = "読み込み中…";
    try{
      const data = await adminGET("/api/admin/pending");
      render(data.items || []);
      $("msg").textContent = `取得OK（${(data.items||[]).length}件）`;
    }catch(e){
      $("msg").textContent = "エラー: " + e.message;
    }
  }

  $("load").onclick = load;
</script>
</body>
</html>

<!-- END -->
