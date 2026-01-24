// admin.js
(() => {
  const $ = (id) => document.getElementById(id);

  const LS_API = "tatoete_api_base_v1";
  const LS_KEY = "tatoete_admin_key_v1";

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setStatus(msg, ok=true){
    const el = $("status");
    el.className = "meta " + (ok ? "ok" : "ng");
    el.textContent = msg;
  }

  function getApiBase() {
    const v = $("apiBase").value.trim();
    return v.replace(/\/+$/, ""); // 末尾スラッシュ除去
  }
  function getAdminKey() {
    return $("adminKey").value.trim();
  }

  async function api(path, opts = {}) {
    const base = getApiBase();
    if (!base) throw new Error("API_BASE が空です");
    const url = base + path;

    const headers = Object.assign({}, opts.headers || {});
    const key = getAdminKey();
    if (key) headers["x-admin-key"] = key;

    const res = await fetch(url, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      const msg = data?.error || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  function render(items) {
    const root = $("list");
    if (!items || !items.length) {
      root.innerHTML = `<p class="meta">承認待ちはありません。</p>`;
      return;
    }

    root.innerHTML = items.map(it => {
      const id = esc(it.id);
      const mode = esc(it.mode);
      const bucket = esc(it.bucket);
      const from = esc(it.from || "");
      const created = new Date(Number(it.createdAt || 0)).toLocaleString();
      const text = esc(it.text || "");

      return `
        <div class="card" data-id="${id}">
          <div class="meta">
            <b>ID</b>: <code>${id}</code>　
            <b>mode</b>: ${mode}　
            <b>bucket</b>: ${bucket}　
            <b>from</b>: ${from || "-"}　
            <b>at</b>: ${created}
          </div>
          <div class="text">${text}</div>
          <div class="row" style="margin-top:10px;">
            <button class="primary" data-act="approve">承認</button>
            <button class="danger" data-act="reject">却下</button>
          </div>
        </div>
      `;
    }).join("");
  }

  async function refresh() {
    setStatus("取得中…");
    const data = await api("/api/pending", { method: "GET" });
    render(data.items || []);
    setStatus(`承認待ち: ${(data.items || []).length} 件`, true);
  }

  async function approve(id) {
    setStatus("承認中…");
    await api("/api/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    setStatus("承認しました ✅");
    await refresh();
  }

  async function reject(id) {
    setStatus("却下中…", true);
    await api("/api/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    setStatus("却下しました ✅");
    await refresh();
  }

  // events
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.getAttribute("data-act");
    const card = btn.closest(".card");
    const id = card?.getAttribute("data-id");
    if (!id) return;

    try {
      if (act === "approve") await approve(id);
      if (act === "reject") await reject(id);
    } catch (err) {
      setStatus(`エラー: ${err.message}`, false);
      console.error(err);
    }
  });

  $("saveKey").addEventListener("click", () => {
    localStorage.setItem(LS_API, $("apiBase").value.trim());
    localStorage.setItem(LS_KEY, $("adminKey").value.trim());
    setStatus("保存しました");
  });

  $("refresh").addEventListener("click", async () => {
    try { await refresh(); }
    catch (err) {
      setStatus(`エラー: ${err.message}`, false);
      console.error(err);
    }
  });

  // init
  $("apiBase").value = localStorage.getItem(LS_API) || "https://ancient-union-4aa4tatoete-kousui-api.y-yoshioka27.workers.dev";
  $("adminKey").value = localStorage.getItem(LS_KEY) || "";
  refresh().catch(err => setStatus(`エラー: ${err.message}`, false));
})();
