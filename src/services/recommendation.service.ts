import type {
  EmotionalProfile,
  VerseRecommendation,
  Verse,
  CrisisResources,
  ActivityCategory,
  ActivitySuggestion,
  LocationContext,
} from '../types/index.js';
import { getVersesByKeys } from './verse.service.js';
import { generatePersonalizedNote } from './nlp.service.js';
import { semanticVerseSearch, type SemanticMatch } from './semanticSearch.service.js';
import { getNearbyActivities } from './activityProvider.service.js';
import {
  getFallbackVerseKeys,
  CRISIS_VERSE_KEY,
  CRISIS_SUPPORT_VERSE_KEYS,
} from '../utils/emotionTaxonomy.js';
import { getActivityCategories } from '../utils/activityTaxonomy.js';

// ─── Crisis Resources ─────────────────────────────────────────────────────────

export const CRISIS_RESOURCES: CrisisResources = {
  message:
    'It sounds like you may be going through a very difficult time. ' +
    'You are not alone — help is available. Please reach out to someone you trust, ' +
    'or contact a crisis helpline near you.',
  hotlines: [
    {
      name: 'International Association for Suicide Prevention',
      number: 'https://www.iasp.info/resources/Crisis_Centres/',
      available: '24/7',
      country: 'International',
    },
    {
      name: 'National Suicide Prevention Lifeline (USA)',
      number: '988',
      available: '24/7',
      country: 'USA',
    },
    {
      name: 'Samaritans (UK & Ireland)',
      number: '116 123',
      available: '24/7',
      country: 'UK/Ireland',
    },
    {
      name: 'Befrienders Worldwide',
      number: 'www.befrienders.org',
      available: '24/7',
      country: 'International',
    },
    {
      name: 'Muslim Youth Helpline (UK)',
      number: '0808 808 2008',
      available: 'Mon–Fri 4pm–10pm',
      country: 'UK',
    },
    {
      name: 'iCall (India)',
      number: '9152987821',
      available: 'Mon–Sat 8am–10pm IST',
      country: 'India',
    },
  ],
};

// ─── Scoring Weights ──────────────────────────────────────────────────────────

const INTENSITY_WEIGHT = 0.3;
const THEME_OVERLAP_WEIGHT = 0.4;
const SPIRITUAL_NEED_WEIGHT = 0.3;
const SEMANTIC_WEIGHT = 0.5; // applied on top when a verse has a semantic match

// ─── Heuristic Scorer ─────────────────────────────────────────────────────────

/**
 * Computes a relevance score [0, 1] for a verse given an emotional profile.
 *
 * This is the deterministic layer: taxonomy metadata (curated, reviewed
 * verse lists per emotion) plus the profile Claude produced. It runs
 * regardless of whether semantic search is available, so the app always
 * has a reliable ranking — see getRecommendations for how a semantic
 * similarity score (when available) is blended on top of this.
 */
export function scoreVerse(
  verseKey: string,
  profile: EmotionalProfile,
  emotionVerseKeys: string[],
  semanticSimilarity?: number,
): number {
  // Base score: is this verse in the curated list for this emotion?
  const inEmotionList = emotionVerseKeys.includes(verseKey);
  const baseScore = inEmotionList ? 0.6 : 0.3;

  // Intensity modifier: higher intensity → higher urgency → prefer comforting/crisis verses
  const intensityModifier = (profile.intensity / 10) * INTENSITY_WEIGHT;

  // Position-in-list bonus: earlier in the curated list = slightly higher relevance
  const position = emotionVerseKeys.indexOf(verseKey);
  const positionBonus =
    position >= 0
      ? ((emotionVerseKeys.length - position) / emotionVerseKeys.length) *
        THEME_OVERLAP_WEIGHT
      : 0;

  // Spiritual need alignment bonus
  const spiritualBonus =
    profile.spiritual_need === 'comfort' && profile.intensity > 6
      ? SPIRITUAL_NEED_WEIGHT * 0.5
      : profile.spiritual_need === 'forgiveness' && verseKey === '39:53'
        ? SPIRITUAL_NEED_WEIGHT
        : SPIRITUAL_NEED_WEIGHT * 0.2;

  // Semantic modifier: how close is this verse's translation to what the
  // user actually wrote, in embedding space? Only present when
  // VOYAGE_API_KEY is configured and the verse turned up in the semantic
  // search results — see getRecommendations. Verses found *only* via
  // semantic search (not in the curated list) rely almost entirely on
  // this term, which is intentional: it's how the retrieval layer
  // surfaces verses the hand-curated taxonomy didn't anticipate.
  const semanticModifier = (semanticSimilarity ?? 0) * SEMANTIC_WEIGHT;

  const rawScore =
    baseScore + intensityModifier + positionBonus + spiritualBonus + semanticModifier;
  return Math.min(1, Math.max(0, rawScore));
}

// ─── Build VerseRecommendation Array ─────────────────────────────────────────

async function buildRecommendations(
  verses: Verse[],
  profile: EmotionalProfile,
  emotionVerseKeys: string[],
  language?: string,
  semanticScores?: Map<string, number>,
): Promise<VerseRecommendation[]> {
  // Compute heuristic score for each verse, blended with semantic
  // similarity when available (see scoreVerse for how the two combine).
  const scored = verses.map((verse) => {
    const finalScore = scoreVerse(
      verse.verse_key,
      profile,
      emotionVerseKeys,
      semanticScores?.get(verse.verse_key),
    );
    return { verse, finalScore };
  });

  // Sort by score descending
  scored.sort((a, b) => b.finalScore - a.finalScore);

  // Take top 5
  const top = scored.slice(0, 5);

  // Generate personalised notes in parallel
  const recommendations = await Promise.all(
    top.map(async ({ verse, finalScore }): Promise<VerseRecommendation> => {
      const note = await generatePersonalizedNote(
        verse.verse_key,
        verse.translation,
        profile,
        language,
      );

      return {
        verse_key: verse.verse_key,
        surah_number: verse.surah_number,
        ayah_number: verse.ayah_number,
        arabic_text: verse.arabic_text,
        translation: verse.translation,
        transliteration: verse.transliteration,
        personalized_note: note,
        relevance_score: Math.round(finalScore * 1000) / 1000,
        tafsir_summary: verse.tafsir_summary,
      };
    }),
  );

  return recommendations;
}

// ─── Main Recommendation Function ────────────────────────────────────────────

/**
 * Generates personalised Quran verse recommendations for a given emotional profile.
 *
 * Steps:
 * 1. Gather candidate verse keys from the curated emotion taxonomy (always available)
 * 2. In parallel, run semantic search against the user's raw text (RAG layer —
 *    only active when VOYAGE_API_KEY is configured and verse_embeddings is
 *    populated; silently contributes nothing otherwise)
 * 3. Merge both candidate sets — crisis verses always take priority
 * 4. Fetch verse content from the verse service
 * 5. Score candidates using the curated taxonomy + semantic similarity blend
 * 6. Generate personalised notes for the top results
 * 7. Return ranked VerseRecommendation array
 *
 * `rawText` is the PII-scrubbed check-in text (see checkin.ts) — it's what
 * gets embedded for semantic search. It's optional because mood-only
 * check-ins (no free text) have nothing meaningful to embed; those rely
 * entirely on the taxonomy, which is expected and fine.
 */
export async function getRecommendations(
  profile: EmotionalProfile,
  language?: string,
  rawText?: string,
): Promise<{ recommendations: VerseRecommendation[]; crisis_resources?: CrisisResources }> {
  // Step 1: Build candidate list from emotion taxonomy
  const emotionKeys = getFallbackVerseKeys(profile.primary_emotion);
  let candidateKeys = [...emotionKeys];

  // Step 2: Semantic search (RAG) — runs alongside the taxonomy lookup,
  // never blocks or replaces it. See semanticSearch.service.ts for the
  // "no key configured → return []" behaviour that makes this safe to
  // always call.
  const semanticMatches: SemanticMatch[] = rawText
    ? await semanticVerseSearch(rawText, { matchCount: 8, minSimilarity: 0.3 })
    : [];

  const semanticScores = new Map<string, number>(
    semanticMatches.map((m) => [m.verse_key, m.similarity]),
  );

  candidateKeys = [...candidateKeys, ...semanticMatches.map((m) => m.verse_key)];

  // Step 3: Crisis handling — always takes priority over both taxonomy and
  // semantic candidates. This path is unaffected by whether RAG is enabled.
  if (profile.crisis) {
    candidateKeys = candidateKeys.filter((k) => k !== CRISIS_VERSE_KEY);
    candidateKeys = [CRISIS_VERSE_KEY, ...CRISIS_SUPPORT_VERSE_KEYS, ...candidateKeys];
  }

  // Deduplicate while preserving order (taxonomy/crisis verses first, so
  // ties in the scorer favour the reviewed list)
  const seen = new Set<string>();
  const deduped = candidateKeys.filter((k) => {
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Limit candidates to keep note-generation cost (one Claude call per verse) reasonable
  const limited = deduped.slice(0, 12);

  // Step 4: Fetch verse content in parallel
  const verses = await getVersesByKeys(limited, language);

  if (verses.length === 0) {
    // Absolute fallback: return empty array (UI should handle this gracefully)
    return { recommendations: [] };
  }

  // Step 5 & 6: Score (taxonomy + semantic blend) and build recommendations
  // with personalised notes
  const recommendations = await buildRecommendations(
    verses,
    profile,
    emotionKeys,
    language,
    semanticScores,
  );

  const result: { recommendations: VerseRecommendation[]; crisis_resources?: CrisisResources } = {
    recommendations,
  };

  if (profile.crisis) {
    result.crisis_resources = CRISIS_RESOURCES;
  }

  return result;
}

// ─── Activity Recommendations (real-world, not scripture) ────────────────────
//
// A second recommendation track alongside verses: instead of "what does the
// Quran say about this feeling," this answers "what's something I could
// actually go do right now." Reuses the same shape of reasoning as
// scoreVerse — a curated priority list (activityTaxonomy.ts) blended with
// contextual signals (open-now, distance, current traffic, estimated
// parking difficulty) — and the same "always have a deterministic
// fallback" philosophy as the verse RAG layer: with no API key configured,
// activityProvider.service.ts returns a hand-written sample catalog instead
// of nothing.
//
// Traffic and parking exist specifically so the app doesn't work against
// its own purpose: a relevant suggestion that requires sitting in traffic
// and hunting for parking adds stress instead of relieving it, so both
// pull a suggestion's score down (see scoreActivity below).

const CATEGORY_PRIORITY_WEIGHT = 0.3;
const OPEN_NOW_WEIGHT = 0.2;
const DISTANCE_WEIGHT = 0.2;
const TRAFFIC_WEIGHT = 0.15;
const PARKING_WEIGHT = 0.15;
const MAX_RELEVANT_DISTANCE_KM = 8;
// Traffic delays beyond this are treated as equally bad — the point isn't
// to precisely rank a 25-vs-30-minute delay, just to clearly favour "no
// meaningful delay" over "significant delay" when everything else is equal.
const MAX_RELEVANT_TRAFFIC_DELAY_MIN = 20;

/**
 * Computes a relevance score [0, 1] for an activity suggestion, given the
 * ordered category priority list for the user's current emotion.
 *
 * Weighs two stress-reduction signals alongside the original three
 * (category fit, open-now, distance): current traffic delay and estimated
 * parking difficulty. The whole point of suggesting something is to help —
 * a technically-relevant venue that requires a stressful drive and a
 * parking hunt works against that, so both pull the score down. Missing
 * data (no API key configured, a failed lookup) gets a neutral half-weight
 * rather than a penalty, same treatment as unknown open-now status below —
 * we shouldn't assume the worst just because we don't have the data.
 */
export function scoreActivity(
  suggestion: ActivitySuggestion,
  priorityCategories: ActivityCategory[],
): number {
  const priorityIndex = priorityCategories.indexOf(suggestion.category);
  const priorityScore =
    priorityIndex >= 0
      ? ((priorityCategories.length - priorityIndex) / priorityCategories.length) *
        CATEGORY_PRIORITY_WEIGHT
      : 0;

  // Unknown open status gets a middling score rather than being penalized
  // outright — we shouldn't assume something's closed just because we
  // don't have hours data for it (e.g. some Google Places results omit
  // opening_hours entirely).
  const openScore =
    suggestion.is_open_now === true
      ? OPEN_NOW_WEIGHT
      : suggestion.is_open_now === false
        ? 0
        : OPEN_NOW_WEIGHT * 0.5;

  const distance = suggestion.distance_km ?? MAX_RELEVANT_DISTANCE_KM / 2;
  const distanceScore =
    Math.max(0, (MAX_RELEVANT_DISTANCE_KM - distance) / MAX_RELEVANT_DISTANCE_KM) *
    DISTANCE_WEIGHT;

  const trafficScore =
    suggestion.traffic_delay_minutes === undefined
      ? TRAFFIC_WEIGHT * 0.5
      : Math.max(
          0,
          (MAX_RELEVANT_TRAFFIC_DELAY_MIN - suggestion.traffic_delay_minutes) /
            MAX_RELEVANT_TRAFFIC_DELAY_MIN,
        ) * TRAFFIC_WEIGHT;

  const parkingScore =
    suggestion.parking_difficulty === 'easy'
      ? PARKING_WEIGHT
      : suggestion.parking_difficulty === 'moderate'
        ? PARKING_WEIGHT * 0.5
        : suggestion.parking_difficulty === 'hard'
          ? 0
          : PARKING_WEIGHT * 0.5; // unknown -> neutral

  const rawScore = priorityScore + openScore + distanceScore + trafficScore + parkingScore;
  return Math.min(1, Math.max(0, rawScore));
}

/**
 * Generates real-world activity suggestions for a given emotional profile
 * and location. Returns an empty array (never throws) if location is
 * unavailable or the lookup fails — callers should treat this exactly like
 * an optional field, the same way crisis_resources is optional on
 * CheckinResponse.
 *
 * `vibe`, if given, hard-filters candidates to quiet/moderate/lively
 * (see activityProvider.service.ts) before scoring — this powers the
 * mobile app's Quiet/Lively toggle when a client wants the server to do
 * the filtering rather than filtering the returned list itself.
 */
export async function getActivityRecommendations(
  profile: EmotionalProfile,
  location: LocationContext,
  now: Date = new Date(),
  vibe?: import('../types/index.js').Vibe,
): Promise<ActivitySuggestion[]> {
  const categories = getActivityCategories(profile.primary_emotion);

  const candidates = await getNearbyActivities(location, categories, now, vibe);
  if (candidates.length === 0) return [];

  const scored = candidates
    .map((suggestion) => ({
      ...suggestion,
      relevance_score: Math.round(scoreActivity(suggestion, categories) * 1000) / 1000,
    }))
    .sort((a, b) => b.relevance_score - a.relevance_score);

  // Returns a larger pool than before (8, not 4) — both to give a
  // client-side Quiet/Lively toggle (see the mobile app) enough of both
  // vibes to work with, and because the category taxonomy was widened from
  // 2 to 3 categories per emotion (see activityTaxonomy.ts), so there's a
  // broader, more varied candidate pool to draw the top results from.
  return scored.slice(0, 8);
}
