# Nur — Backend

API for **Nur** (نور = "Light"), a Quranic wellbeing check-in app. It takes a user's emotional state and returns personalized Quran verse recommendations with context.

Frontend: [nur-mobile](https://github.com/yujikarlyoshida/nur-mobile)

## Stack

- **Fastify** + **TypeScript** (Node.js, ESM)
- **Zod** for request validation
- **Anthropic Claude API** for emotion classification and personalized notes
- **Voyage AI embeddings + pgvector** for semantic verse retrieval (RAG layer — optional, see below)
- **Quran.com API v4** for verse text and translations
- **Google Places API** for real-world activity suggestions (optional, see below — a sample catalog is used otherwise)
- **Supabase** (Postgres) for check-in persistence and vector search
- `@fastify/helmet`, `@fastify/cors`, `@fastify/sensible` for security and error handling
- **Vitest** for unit tests, **GitHub Actions** for CI, **Docker** for deployment

## How it works

1. `POST /api/checkin` receives the user's input (`text`, `voice_transcript`, or `mood_select`).
2. Any free text is scrubbed for PII before it reaches any external service.
3. The input is classified into an emotional profile (primary emotion, intensity, spiritual need, life domain, themes) via Claude, with built-in crisis-signal detection.
4. Candidate verses are gathered from two independent sources and blended: a hand-curated, reviewed taxonomy (`emotionTaxonomy.ts`, always available) and, when configured, semantic similarity search over verse embeddings (`semanticSearch.service.ts` — genuine RAG, not just an LLM call). The curated list is the deterministic safety net; semantic search augments relevance without ever fully replacing it — see the comments in `recommendation.service.ts` for why that split matters for a faith-context product.
5. Each recommended verse gets a personalized note explaining why it fits.
6. If the client sends `location` (`{ latitude, longitude }`), a second, independent recommendation track runs alongside verses: `activity_suggestions` — real-world things to do nearby, matched to the same emotional profile and the current time of day (`activityTaxonomy.ts` + `activityProvider.service.ts`). This is optional and additive; check-ins without a location behave exactly as they did before this existed.
7. The check-in and recommendations are persisted to Supabase on a best-effort basis (non-blocking — a DB failure never breaks the response).
8. If a crisis signal is detected, the response includes `crisis_resources` with hotline info.

## Endpoints

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/checkin` | Submit emotional input (+ optional location), get back an emotional profile, verse recommendations, and (if location was sent) `activity_suggestions` |
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
npm run build        # compile TypeScript
npm start             # run compiled output
npm run type-check
npm test               # run the Vitest suite
```

### Enabling semantic search (RAG)

The app runs fine without this — it just falls back to the curated taxonomy. To turn it on:

1. Run `src/db/schema.sql` against your Supabase project (adds the `pgvector` extension, a `verse_embeddings` table, and a `match_verses` search function).
2. Get a [Voyage AI](https://dash.voyageai.com) API key (Anthropic's recommended embeddings partner — Claude itself has no embeddings endpoint) and set `VOYAGE_API_KEY` in `.env`.
3. Run `npm run backfill:embeddings` once — embeds and stores all 6,236 Quran verses (a few minutes; talks to Quran.com, Voyage AI, and Supabase).

### Enabling real activity suggestions (Google Places)

Send a `location` field with a check-in and the app returns `activity_suggestions` immediately — no setup required, because `activityProvider.service.ts` falls back to a hand-written sample catalog (clearly marked `"source": "sample"`) when no places API key is configured. To get real, live venues instead:

1. Enable the "Places API" in a [Google Cloud project](https://console.cloud.google.com) and generate an API key.
2. Set `GOOGLE_PLACES_API_KEY` in `.env`.

That's it — no schema changes, no backfill job. Suggestions are scored the same way either way (category priority for the detected emotion, open-now status, distance); only the venue data source changes.

### Docker

```bash
docker build -t nur-backend .
docker run -p 3000:3000 --env-file .env nur-backend
```

### Deploying to AWS

Elastic Beanstalk config is already set up (`.elasticbeanstalk/config.yml`, Node.js 20, `nur-backend-prod`, us-east-1):

```bash
eb deploy
```

## Notes

- Not a medical app — this is a spiritual wellness tool. Crisis detection routes users to real hotlines rather than attempting to provide care itself.
- 13-emotion taxonomy shared with the mobile app: anxiety, sadness, anger, loneliness, gratitude, hope, guilt, confusion, peace, overwhelmed, grief, disconnection, joy.
- Semantic search is intentionally additive, not a replacement for the curated taxonomy — see the design note at the top of `src/db/schema.sql`'s `verse_embeddings` section for the reasoning.
- Activity suggestions are a second, independent recommendation type (real-world actions, not scripture) — see the design note at the top of `recommendation.service.ts`'s activity section for how it's scored and why it stays optional.
