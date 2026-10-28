# InkGuard frontend

This React/Vite app is the browser client for the InkGuard FastAPI backend. Product architecture, implemented features, limitations, and full setup instructions are in the [project README](../../../../README.md).

Run from Command Prompt:

```cmd
cd /d D:\inkguard-main\frontend\inkguard
pnpm install --filter "@workspace/inkguard..."
cd artifacts\inkguard
set "PORT=5173"
set "BASE_PATH=/"
set "VITE_API_BASE_URL=http://127.0.0.1:8000"
pnpm dev
```

The backend must be running before sign-in or review. Rule-based review works without an external AI key. OpenRouter is an optional backend-only mode; if enabled, keep its key on the server and never place it in a `VITE_` variable.
