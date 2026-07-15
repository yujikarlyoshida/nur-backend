# Nur — Backend

API for **Nur** (نور = "Light"), a Quranic wellbeing check-in app. It takes a user's emotional state and returns personalized Quran verse recommendations with context.

Frontend: [nur-mobile](https://github.com/yujikarlyoshida/nur-mobile)

## Stack

- **Fastify** + **TypeScript** (Node.js, ESM)
- **Zod** for request validation
- **Anthropic Claude API** for emotion classification and personalized notes
- **Voyage AI embeddings + pgvector** for semantic verse retrieval (RAG layer — optional, see below)
- **Quran.com API v4** for verse text and translations
- **Google Places API** for real-world activity suggestions, plus optionally the **Distance Matrix API** for real-time traffic-aware travel time (optional, see below — a sample catalog is used otherwise)
- **Supabase** (Postgres) for check-in persistence and vector search
- `@fastify/helmet`, `@fastify/cors`, `@fastify/sensible` for security and error handling
- **Vitest** for unit tests, **GitHub Actions** for CI, **Docker** for deployment

## How it works

1. `POST /api/checkin` receives the user's input (`text`, `voice_transcript`, or `mood_select`).
2. Any free text is scrubbed for PII before it reaches any external service.
3. The input is classified into an emotional profile (primary emotion, intensity, spiritual need, life domain, themes) via Claude, with built-in crisis-signal detection.
4. Candidate verses are gathered from two independent sources and blended: a hand-curated, reviewed taxonomy (`emotionTaxonomy.ts`, always available) and, when configured, semantic similarity search over verse embeddings (`semanticSearch.service.ts` — genuine RAG, not just an LLM call). The curated list is the deterministic safety net; semantic search augments relevance without ever fully replacing it — see the comments in `recommendation.service.ts` for why that split matters for a faith-context product.
5. Each recommended verse gets a personalized note explaining why it fits.
6. If the client sends `location` (`{ latitude, longitude }`), a second, independent recommendation track runs alongside verses: `activity_suggestions` — real-world things to do nearby, matched to the same emotional profile, the current time of day, and (if `vibe` is sent) a hard quiet/moderate/lively filter (`activityTaxonomy.ts` + `activityProvider.service.ts`). Every suggestion is halal-conscious by construction — see "Enabling real activity suggestions" below. This is optional and additive; check-ins without a location behave exactly as they did before this existed.
7. Verses and activities run **concurrently**, not one after another — see "Architecture" below.
8. The check-in and recommendations are persisted to Supabase on a best-effort basis (non-blocking — a DB failure never breaks the response).
9. If a crisis signal is detected, the response includes `crisis_resources` with hotline info.

## Architecture: adding a new recommendation type

Verses and activities are both implementations of one `RecommendationProvider` interface (`src/services/recommendationProviders.ts`):

```ts
interface RecommendationProvider {
  name: string;
  isApplicable(ctx: RecommendationContext): boolean;
  run(ctx: RecommendationContext): Promise<RecommendationContribution>;
}
```

`checkin.ts` doesn't call `getRecommendations` and `getActivityRecommendations` directly — it calls `runRecommendationProviders(ctx)` once, which runs every applicable provider **concurrently** via `Promise.allSettled` and merges whatever comes back. One provider throwing never blocks or breaks the others.

To add a third recommendation type (dhikr reminders, community events, whatever's next): write a provider that implements the interface and add it to `REGISTERED_PROVIDERS`. Nothing in the route handler needs to change.

## Endpoints

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/checkin` | Submit emotional input (+ optional `location`, `vibe`), get back an emotional profile, verse recommendations, and (if location was sent) `activity_suggestions` |
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

With a key configured, each suggestion is also enriched with today's regular + holiday/special hours (a Place Details call per result, run concurrently) and a `vibe` (`quiet` / `moderate` / `lively`). On foot traffic specifically: Google doesn't expose real-time or predicted busyness through its public Places API (that's a paid third-party service like BestTime.app, not something this app integrates) — `vibe` is instead *estimated* for free from category, rating, review volume, price level, and time of day (`estimateVibe()` in `activityProvider.service.ts`). Send `vibe: "quiet" | "moderate" | "lively"` in the check-in request to hard-filter results server-side; the mobile app instead filters client-side over an already-returned pool so its Quiet/Lively toggle doesn't need a second request.

Every activity suggestion — sample or live — is halal-conscious by construction, unconditionally (this is not a per-user preference to toggle). Two layers, applied in `activityProvider.service.ts` before a candidate is ever scored or returned:

1. Google place `types` that are never halal (`bar`, `night_club`, `liquor_store`, `casino`) are hard-excluded outright.
2. A name-keyword blocklist (`isHalalExcluded()`) catches what `types` misses — a `restaurant`-typed pork BBQ joint, a `lounge` that's really a bar, alcohol venues (pub, brewery, winery, distillery), and pork/gelatin-centric food (pork, bacon, ham, charcuterie, gelatin). Food-adjacent category searches (`social_gathering`, `celebration`) also bias their keyword query toward `"halal restaurant"` so live results skew halal-friendly to begin with, not just away from excluded venues.

This is a best-effort filter, not a halal-certification check — Google's public API doesn't expose certification data, so nothing here can *guarantee* a venue is certified halal. See `tests/halalFilter.test.ts` for the exact cases covered, and extend `EXCLUDED_NAME_PATTERNS` in `activityProvider.service.ts` if a gap shows up in practice.

The activity taxonomy (`activityTaxonomy.ts`) also maps each emotion to 3 categories now instead of 2, and the Places search radius/result count were widened (12km, up to 8 candidates per category before scoring) — a broader, more varied pool for the same amount of location data.

#### Traffic and parking (time-based, stress-aware)

The point of a suggestion is to help, not to add a stressful drive on top of whatever the user is already feeling — so every live suggestion also carries two signals that pull its relevance score down when they'd make getting there a hassle:

- **`travel_time_minutes` / `traffic_delay_minutes` — real data.** Enable the **Distance Matrix API** in the same Google Cloud project as Places (it's a separate API to turn on, same API key). With it enabled, each suggestion gets a live driving-time lookup (`departure_time=now`, `traffic_model=best_guess`) — genuine current traffic, not an estimate. Without it (or on any lookup failure), the suggestion just ships without these fields rather than breaking the request, same fail-soft pattern as everything else optional here.
- **`parking_difficulty` — a heuristic, like `vibe`.** There's no free public API for real-time parking-spot availability, so this is estimated from category (dedicated-lot venues like parks and mosques default easier than dense dining/nightlife-adjacent venues), current time (rush hour and weekend evenings skew harder everywhere), review volume, and price level. See `estimateParkingDifficulty()` in `activityProvider.service.ts`.

Both feed into `scoreActivity()` in `recommendation.service.ts` alongside category fit, open-now status, and distance — a technically-relevant venue that requires sitting in traffic and hunting for parking now scores below an equally relevant one that's easy to actually get to. Missing data (API not enabled, a failed lookup) gets a neutral score rather than a penalty — the same treatment already given to unknown open-now status.

### Seeding 50 demo users

For testing or demoing against a populated database rather than an empty one:

```bash
npm run seed:demo-users
```

Requires `SUPABASE_SERVICE_ROLE_KEY` in `.env` (see `.env.example` — the anon key can't create auth users or insert rows with an explicit `id`, only the service role key can). Creates 50 Supabase Auth users (`demo.user01@nurdemo.test` through `demo.user50@nurdemo.test`, random unused passwords) plus matching `public.users` profiles and 1–3 synthetic check-ins with verse recommendations each, generated locally from the curated emotion taxonomy — no Claude or Voyage AI calls, so it's fast and free to run. Safe to bulk-delete later via the Supabase dashboard (filter Authentication by the `@nurdemo.test` domain).

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
- Performance: verse text is cached in-memory (1hr TTL, `verse.service.ts`) so repeat check-ins referencing the same well-known verses don't re-hit Quran.com. Activity category lookups run concurrently, not sequentially. Verse and activity recommendations run concurrently via the provider registry (see "Architecture" above) rather than one after another.
