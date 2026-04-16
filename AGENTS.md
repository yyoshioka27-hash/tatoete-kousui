# AGENTS.md

## Project overview
- This repository is a precipitation probability web app.
- Frontend is served with GitHub Pages.
- Backend/API uses Cloudflare Workers and KV.
- Key files:
  - `worker.js`
  - `admin.html`
  - `script.js`
  - `sw.js`

## Working rules
- Do not remove existing features unless explicitly instructed.
- Prefer the smallest safe change.
- Do not do broad refactors unless explicitly requested.
- Keep UI text and layout unchanged unless explicitly requested.
- Before editing code, explain the current flow and root cause briefly.
- After editing code, explain changed files, verification steps, and possible side effects.

## Performance rules
- Avoid full rebuilds for routine admin updates.
- Prefer incremental updates, cached lists, snapshots, and reuse of existing indexes.
- Avoid expensive full scans of KV during normal admin operations.
- Keep solutions practical for a repo expected to support around 1000 users.

## Admin panel rules
- Treat normal refresh and full rebuild as separate operations.
- For new-item flows, prefer updating only the affected item/list instead of reloading everything.
- Do not break hall-of-fame, rankings, or existing admin workflows.

## Files to check first
- For admin refresh slowness: `admin.html`, `worker.js`
- For stale cache issues: `sw.js`, `script.js`
- For ranking / hall-of-fame issues: `worker.js`, relevant fetch logic in `script.js`

## Done when
- Requested behavior is fixed with minimal diff.
- Existing major features still work.
- Risky side effects are called out clearly.
- Verification steps are included.
