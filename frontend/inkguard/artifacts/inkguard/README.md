# InkGuard

InkGuard is a frontend-only brand review workspace for authors checking drafts against brand guidelines and approved facts. The interface keeps human review and editorial decisions explicit. It does not provide authentication or persist decisions to a server.

## Setup

```sh
cd artifacts/inkguard
pnpm install
cp .env.example .env
pnpm dev
```

Set `VITE_API_BASE_URL` to the base URL of the FastAPI service. The default is `http://localhost:8000`. Vite exposes only `VITE_` variables to the browser. The API service must allow the frontend origin through CORS during local development.

## Feature boundaries

| Feature | Current implementation |
| --- | --- |
| Analyze a draft | Real `POST {VITE_API_BASE_URL}/analyze` request |
| Analysis not configured response | Calm informational state; not treated as a clean review |
| Retry and error handling | Network, timeout, HTTP status, and invalid JSON states |
| Demo review | Clearly labeled local sample findings; does not call the API |
| Finding decisions | Browser session only; refresh may lose decisions |
| Brand Kit | Browser `localStorage` only |
| Role simulation | Creator, Manager, and Reviewer controls; not authentication |
| Queue, comments, activity, insights | Explicitly labeled local/sample data |
| Inky help | Rule-based local FAQ; no AI and no text sent to a chatbot service |
| Decision persistence | Not implemented; `saveDecision` is a labeled stub |

The only network request implemented by this frontend is `POST /analyze`. It sends exactly:

```json
{
  "brand_name": "string",
  "content": "string",
  "brand_guidelines": ["string"],
  "approved_facts": ["string"]
}
```

The temporary response expected by the UI is:

```json
{
  "status": "analysis_not_configured",
  "findings": [],
  "message": "AI analysis is not connected yet."
}
```

Findings require an `issue` string; optional fields are `id`, `severity`, `evidence`, `brand_rule`, `explanation`, `suggested_correction`, `confidence`, and `category`. The UI safely handles missing optional values and unknown severity values.

## Suggested future API contract

1. Add a decision endpoint to persist finding decisions and suggested/edited replacements, with review ID, actor, timestamp, optional reason, and resulting status.
2. Add an audit endpoint to provide permission-aware review events for Activity and Insights rather than sample/session data.
3. If conversational assistance is desired, define an optional chat endpoint with explicit privacy and retention rules. Inky currently remains local and rule-based.

No backend, database, OpenAPI, or server files are changed by this project.
