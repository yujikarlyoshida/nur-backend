# Nur — Backend

API for **Nur** (نور = "Light"), a Quranic wellbeing check-in app. It takes a user's emotional state and returns personalized Quran verse recommendations with context.

Frontend: [nur-mobile](https://github.com/yujikarlyoshida/nur-mobile)

## Stack

- **Fastify** + **TypeScript** (Node.js, ESM)
- **Zod** for request validation
- **Anthropic Claude API** for emotion classification
- **Quran.com API v4** for verse text and translations
- **Supabase** for check-in persistence
- `@fastify/helmet`, `@fastify/cors`, `@fastify/sensible` for security and error handling

## How it works

1. `POST /api/checkin` receives the user's input (`text`, `voice_transcript`, or `mood_select`).
2. Any free text is scrubbed for PII before it reaches any external service.
3. The input is classified into an emotional profile (primary emotion, intensity, spiritual need, life domain, themes) via Claude, with built-in crisis-signal detection.
4. Relevant verses are pulled from Quran.com and paired with a personalized note explaining why each one fits.
5. The check-in and recommendations are persisted to Supabase on a best-effort basis (non-blocking — a DB failure never breaks the response).
6. If a crisis signal is detected, the response includes `crisis_resources` with hotline info.

## Endpoints

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/checkin` | Submit emotional input, get back an emotional profile + verse recommendations |
| `GET` | `/api/verses/*` | Verse lookup helpers |
| `GET` | `/api/recommendations/*` | Recommendation helpers |
| `GET` | `/health` | Health check |

## Getting started

```bash
npm install
cp .env.example .env   # add ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_KEY
npm run dev             # starts on http://localhost:3000
```

```bash
npm run build   # compile TypeScript
npm start        # run compiled output
npm run type-check
```

## Notes

- Not a medical app — this is a spiritual wellness tool. Crisis detection routes users to real hotlines rather than attempting to provide care itself.
- 13-emotion taxonomy shared with the mobile app: anxiety, sadness, anger, loneliness, gratitude, hope, guilt, confusion, peace, overwhelmed, grief, disconnection, joy.
