// ==============================
// 追加ネタ管理（localStorage）
// 既存機能は触らず、管理UIだけ増やす（強化版）
// - 旧形式の保存データも自動変換して読み込む
// - 「全確率」「全モード」を選べるようにする（HTMLを触らずJSでoption追加）
// ==============================
(() => {
  const LS_KEY = "extra_phrases_v1";

  // 旧キーがもし存在する場合に拾う（過去の実装差を吸収）
  const LEGACY_KEYS = [
    "extra_phrases",
    "extraPhrases",
    "extra_phrases_v0",
    "extra_phrases_bucket",
    "extra_phrases_store"
  ];

  // ----- utils -----
  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeParse(raw) {
    try { return JSON.parse(raw); } catch { return null; }
  }

  // 旧形式っぽいデータを新形式配列に寄せる
  // 受け入れ想定：
  //  A) [{id, mode, bucket, text, createdAt}, ...]  ←新形式
  //  B) { trivia: { "10": ["...", "..."], "20": [...] }, fun: {...} }  ←旧形式例
  //  C) { "trivia_10": ["..."], "fun_30": ["..."] } ←旧形式例
  //  D) "単なる文字列" ←誤保存
  function normalizeToArray(data) {
    // A) すでに新形式
    if (Array.isArray(data)) {
      return data
        .filter(x => x && typeof x === "object")
        .map(x => ({
          id: x.id || makeId(),
          mode: x.mode || "trivia",
          bucket: Number(x.bucket ?? 0),
          text: String(x.text ?? "").trim(),
          createdAt: Number(x.createdAt ?? Date.now()),
        }))
        .filter(x => x.text);
    }

    // D) 文字列など
    if (!data || typeof data !== "object") return [];

    const out = [];

    // B) { trivia: { "10": ["..."] } }
    if (data.trivia || data.fun) {
      ["trivia", "fun"].forEach(mode => {
        const byBucket = data[mode];
        if (!byBucket || typeof byBucket !== "object") return;
        Object.keys(byBucket).forEach(bucketKey => {
          const arr = byBucket[bucketKey];
          if (!Array.isArray(arr)) return;
          arr.forEach(text => {
            const t = String(text ?? "").trim();
            if (!t) return;
            out.push({
              id: makeId(),
              mode,
              bucket: Number(bucketKey),
              text: t,
              createdAt: Date.now(),
            });
          });
        });
      });
      return out;
    }

    // C) { "trivia_10": ["..."] }
    Object.keys(data).forEach(k => {
      const v = data[k];
      if (!Array.isArray(v)) return;
      const m = k.match(/^(trivia|fun)[_\-](\d+)$/);
      if (!m) return;
      const mode = m[1];
      const bucket = Number(m[2]);
      v.forEach(text => {
        const t = String(text ?? "").trim();
        if (!t) return;
        out.push({
          id: makeId(),
          mode,
          bucket,
          text: t,
          createdAt: Date.now(),
        });
      });
    });

    return out;
  }

  function makeId() {
    return (globalThis.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : String(Date.now()) + "_" + Math.random().toString(16).slice(2);
  }

  function pickExistingRaw() {
    // 新キー優先
    const rawNew = localStorage.getItem(LS_KEY);
    if (rawNew) return rawNew;

    // 旧キーも探す
    for (const k of LEGACY_KEYS) {
      const raw = localStorage.getItem(k);
      if (raw) return raw;
    }
    return null;
  }

  function loadStore() {
    // 形式： [{id, mode, bucket, text, createdAt}, ...]
    const raw = pickExistingRaw();
    if (!raw) return [];

    const parsed = safeParse(raw);
    const normalized = normalizeToArray(parsed);

    // ここで新形式に統一保存しておく（以後ぶれない）
    saveStore(normalized);
    return normalized;
  }

  function saveStore(list) {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  }

  function getMode() {
    const el = $("manageMode");
    return el ? el.value : "trivia";
  }

  function getBucket() {
    const el = $("manageBucket");
    if (!el) return 0;
    // JSで "all" を追加するので吸収
    return el.value === "all" ? "all" : Number(el.value);
  }

  function setStatus(msg, cls = "muted") {
    const el = $("manageStatus");
    if (!el) return;
    el.className = cls;
    el.textContent = msg;
  }

  // ----- render list -----
  function renderManageList() {
    const listEl = $("manageList");
    if (!listEl) return;

    const mode = getMode();        // trivia / fun / all
    const bucket = getBucket();    // number / "all"
    const store = loadStore();

    const filtered = store
      .filter((x) => (mode === "all" ? true : x.mode === mode))
      .filter((x) => (bucket === "all" ? true : Number(x.bucket) === bucket))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const labelMode = mode === "all" ? "全モード" : mode;
    const labelBucket = bucket === "all" ? "全確率" : `${bucket}%`;

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="muted">この条件の追加ネタはありません。</div>`;
      setStatus(`表示：0件（${labelMode}, ${labelBucket}）`, "muted");
      return;
    }

    setStatus(`表示：${filtered.length}件（${labelMode}, ${labelBucket}）`, "ok");

    listEl.innerHTML = `
      <div style="display:grid; gap:8px;">
        ${filtered
          .map(
            (item) => `
          <div style="border:1px solid #eee; border-radius:14px; padding:12px;">
            <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
              <div style="flex:1;">
                <div class="small">
                  <b>${escapeHtml(item.bucket)}%</b> / ${escapeHtml(item.mode)}
                  <span class="muted" style="margin-left:8px;">
                    ${item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}
                  </span>
                </div>
                <div style="margin-top:6px; white-space:pre-wrap; font-size:16px; line-height:1.5;">
                  ${escapeHtml(item.text)}
                </div>
              </div>
              <button data-del-id="${escapeHtml(item.id)}">削除</button>
            </div>
          </div>
        `
          )
          .join("")}
      </div>
    `;

    // 削除ボタン
    listEl.querySelectorAll("button[data-del-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-del-id");
        deleteOne(id);
      });
    });
  }

  function deleteOne(id) {
    const store = loadStore();
    const next = store.filter((x) => x.id !== id);
    saveStore(next);
    renderManageList();
  }

  function clearBucketOrAll() {
    const mode = getMode();
    const bucket = getBucket();
    const store = loadStore();

    const next = store.filter((x) => {
      const modeHit = (mode === "all") ? true : (x.mode === mode);
      const bucketHit = (bucket === "all") ? true : (Number(x.bucket) === bucket);
      // クリア対象（modeHit && bucketHit）を落とす
      return !(modeHit && bucketHit);
    });

    saveStore(next);
    renderManageList();
  }

  function clearAll() {
    saveStore([]);
    renderManageList();
  }

  // ----- add phrase -----
  function addPhraseFromUI() {
    const modeEl = $("newPhraseMode");
    const bucketEl = $("newPhraseBucket");
    const textEl = $("newPhrase");
    const statusEl = $("addStatus");

    if (!modeEl || !bucketEl || !textEl) return;

    const mode = modeEl.value;
    const bucket = Number(bucketEl.value);
    const text = (textEl.value || "").trim();

    if (!text) {
      if (statusEl) statusEl.textContent = "未入力です。ネタ文を入れてください。";
      return;
    }

    const store = loadStore();
    const item = {
      id: makeId(),
      mode,
      bucket,
      text,
      createdAt: Date.now(),
    };
    store.push(item);
    saveStore(store);

    // 入力欄クリア
    textEl.value = "";
    if (statusEl) statusEl.textContent = `保存しました（${mode} / ${bucket}%）`;

    // 管理側を更新
    renderManageList();
  }

  function ensureAllOptions() {
    // HTMLを触らずに「全モード」「全確率」を足す
    const mm = $("manageMode");
    const mb = $("manageBucket");

    if (mm && !Array.from(mm.options).some(o => o.value === "all")) {
      const opt = document.createElement("option");
      opt.value = "all";
      opt.textContent = "全モード";
      mm.insertBefore(opt, mm.firstChild);
    }

    if (mb && !Array.from(mb.options).some(o => o.value === "all")) {
      const opt = document.createElement("option");
      opt.value = "all";
      opt.textContent = "全確率";
      mb.insertBefore(opt, mb.firstChild);
    }
  }

  // ----- bind events on load -----
  document.addEventListener("DOMContentLoaded", () => {
    ensureAllOptions();

    if ($("manageRefresh")) $("manageRefresh").addEventListener("click", renderManageList);
    if ($("manageMode")) $("manageMode").addEventListener("change", renderManageList);
    if ($("manageBucket")) $("manageBucket").addEventListener("change", renderManageList);

    if ($("manageClearBucket")) $("manageClearBucket").addEventListener("click", () => {
      const mode = getMode();
      const bucket = getBucket();
      const labelMode = mode === "all" ? "全モード" : mode;
      const labelBucket = bucket === "all" ? "全確率" : `${bucket}%`;
      if (confirm(`${labelMode} / ${labelBucket} の追加ネタを全削除します。よろしいですか？`)) {
        clearBucketOrAll();
      }
    });

    if ($("manageClearAll")) $("manageClearAll").addEventListener("click", () => {
      if (confirm("全ての追加ネタを削除します。よろしいですか？")) clearAll();
    });

    if ($("addPhraseBtn")) $("addPhraseBtn").addEventListener("click", addPhraseFromUI);

    // 初回表示
    renderManageList();
  });

  // 外部から使えるようにもしておく（例え側に混ぜたいとき用）
  window.getExtraPhrases = (mode, bucket) => {
    const store = loadStore();
    return store
      .filter(x => (mode ? x.mode === mode : true))
      .filter(x => (bucket === undefined || bucket === null ? true : Number(x.bucket) === Number(bucket)))
      .map(x => x.text);
  };

})();
