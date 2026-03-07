# AI Medicine Information System

Production-ready Next.js (App Router) app that:

1. Accepts only a medicine name from the user.
2. Fetches official label data from OpenFDA.
3. Sends structured data to OpenRouter (`mistralai/mistral-7b-instruct:free`, `temperature: 0.2`).
4. Returns and displays a professional, structured response.

## Tech Stack

- Frontend: Next.js App Router
- Backend: Next.js Route Handler (`/api/medicine`)
- External Data Source: OpenFDA Drug Label API
- AI Provider: OpenRouter
- Model: `mistralai/mistral-7b-instruct:free`

## Folder Structure

```text
ai_assintant/
	app/
		api/
			medicine/
				route.ts            # Backend API: OpenFDA + OpenRouter
		globals.css             # UI styling
		layout.tsx              # App metadata/layout
		page.tsx                # Frontend form + result rendering
	public/
	package.json
	tsconfig.json
	README.md
```

## Environment Variables

Create `.env.local`:

```bash
OPENROUTER_API_KEY=your_openrouter_api_key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Run Locally

```bash
npm install
npm run dev
```

Open http://localhost:3000

## API Route

Endpoint: `POST /api/medicine`

Request body:

```json
{
	"medicineName": "ibuprofen"
}
```

Success response shape:

```json
{
	"success": true,
	"source": "openfda",
	"summary": {
		"medicineName": "...",
		"primaryUses": "...",
		"howItWorks": "...",
		"commonSideEffects": "...",
		"warningsPrecautions": "...",
		"importantNotes": "..."
	}
}
```

## OpenFDA Fetch Logic (example)

```ts
const url = `https://api.fda.gov/drug/label.json?search=openfda.generic_name:%22${encodeURIComponent(medicineName)}%22&limit=1`;
const response = await fetch(url, { cache: "no-store" });
```

Extracted fields:

- `purpose`
- `indications_and_usage`
- `warnings`
- `adverse_reactions`
- `description`

## OpenRouter Call (example)

```ts
const completion = await fetch("https://openrouter.ai/api/v1/chat/completions", {
	method: "POST",
	headers: {
		Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
		"Content-Type": "application/json",
		"HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
		"X-Title": "AI Medicine Information System",
	},
	body: JSON.stringify({
		model: "mistralai/mistral-7b-instruct:free",
		temperature: 0.2,
		messages,
		response_format: { type: "json_object" },
	}),
});
```

## Strict AI Guardrails

System prompt enforces:

- Use only provided OpenFDA content
- No hallucination
- No guessing missing data
- Missing fields => `Information not available.`
- No medical advice
- JSON-only structured output

## Frontend Component Behavior

`app/page.tsx`:

- Input for medicine name
- `POST` to `/api/medicine`
- Renders sections:
	- Medicine Name
	- Primary Uses
	- How It Works
	- Common Side Effects
	- Warnings / Precautions
	- Important Notes

## Error Handling Logic

- `400 VALIDATION_ERROR`: missing `medicineName`
- `404 NOT_FOUND`: no OpenFDA label data
- `500 INTERNAL_SERVER_ERROR`: upstream/API/runtime failures
- Frontend shows safe user-facing error card

## Deployment Tips

1. Add env vars (`OPENROUTER_API_KEY`, `NEXT_PUBLIC_APP_URL`) in hosting provider.
2. Prefer server-side API route only for OpenRouter calls (never expose key in client).
3. Add rate-limiting and request logging for production traffic.
4. Add monitoring/alerts for 5xx spikes and upstream failures.
5. Consider response caching for frequently searched medicines.
