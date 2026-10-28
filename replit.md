# InkGuard

InkGuard is a brand-governance MVP. Its default review mode uses deterministic rules and does not require an external AI provider.

## Source of truth

- Backend: `backend` (FastAPI, SQLModel, SQLite).
- Frontend workspace: `frontend/inkguard`.
- Frontend app: `frontend/inkguard/artifacts/inkguard`.
- Product workflow, setup, limitations, and Round 2 checklist: `README.md`.

The root-level generated workspaces are retained for existing repository context; use the frontend workspace above for the InkGuard product described in the README.

## Local checks

- Backend: `py -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000`
- Frontend: run from `frontend/inkguard/artifacts/inkguard` with `PORT=5173`, `BASE_PATH=/`, and `VITE_API_BASE_URL=http://127.0.0.1:8000`.
- Frontend typecheck/build: run `pnpm --filter @workspace/inkguard typecheck` and `pnpm --filter @workspace/inkguard build` from `frontend/inkguard`; set `PORT` and `BASE_PATH` before building.

The backend requires a random `INKGUARD_SECRET_KEY`. Keep secrets in server-side environment variables, never in frontend `VITE_` variables or source control. Optional OpenRouter AI is enabled only with `INKGUARD_AI_MODE=openrouter`, `OPENROUTER_API_KEY`, and `OPENROUTER_MODEL`.
