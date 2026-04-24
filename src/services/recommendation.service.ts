import type {
  EmotionalProfile,
  VerseRecommendation,
  Verse,
  CrisisResources,
} from '../types/index.js';
import { getVersesByKeys } from './verse.service.js';
import { generatePersonalizedNote } from './nlp.service.js';
import {
  getFallbackVerseKeys,
  CRISIS_VERSE_KEY,
  CRISIS_SUPPORT_VERSE_KEYS,
} from '../utils/emotionTaxonomy.js';

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

// ─── Heuristic Scorer ─────────────────────────────────────────────────────────

/**
 * Computes a relevance score [0, 1] for a verse given an emotional profile.
 * Uses taxonomy metadata since we don't have embeddings at this layer.
 */
function scoreVerse(
  verseKey: string,
  profile: EmotionalProfile,
  emotionVerseKeys: string[],
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

  const rawScore = baseScore + intensityModifier + positionBonus + spiritualBonus;
  return Math.min(1, Math.max(0, rawScore));
}

// ─── Build VerseRecommendation Array ─────────────────────────────────────────

async function buildRecommendations(
  verses: Verse[],
  profile: EmotionalProfile,
  emotionVerseKeys: string[],
  language?: string,
): Promise<VerseRecommendation[]> {
  // Compute heuristic score for each verse
  const scored = verses.map((verse) => {
    const finalScore = scoreVerse(verse.verse_key, profile, emotionVerseKeys);
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
 * 1. Gather candidate verse keys from the emotion taxonomy
 * 2. If crisis detected, prepend 39:53 and add crisis support verses
 * 3. Fetch verse content from the verse service
 * 4. Re-rank candidates with GPT-4o-mini
 * 5. Generate personalised notes for the top results
 * 6. Return ranked VerseRecommendation array
 */
export async function getRecommendations(
  profile: EmotionalProfile,
  language?: string,
): Promise<{ recommendations: VerseRecommendation[]; crisis_resources?: CrisisResources }> {
  // Step 1: Build candidate list from emotion taxonomy
  const emotionKeys = getFallbackVerseKeys(profile.primary_emotion);
  let candidateKeys = [...emotionKeys];

  // Step 2: Crisis handling
  if (profile.crisis) {
    // Ensure 39:53 is first
    candidateKeys = candidateKeys.filter((k) => k !== CRISIS_VERSE_KEY);
    candidateKeys = [CRISIS_VERSE_KEY, ...CRISIS_SUPPORT_VERSE_KEYS, ...candidateKeys];
  }

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const deduped = candidateKeys.filter((k) => {
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Limit to 10 candidates for the AI ranker to keep token usage reasonable
  const limited = deduped.slice(0, 10);

  // Step 3: Fetch verse content in parallel
  const verses = await getVersesByKeys(limited, language);

  if (verses.length === 0) {
    // Absolute fallback: return empty array (UI should handle this gracefully)
    return { recommendations: [] };
  }

  // Step 4: Build recommendations with personalised notes (heuristic ranking only)
  const recommendations = await buildRecommendations(
    verses,
    profile,
    emotionKeys,
    language,
  );

  const result: { recommendations: VerseRecommendation[]; crisis_resources?: CrisisResources } = {
    recommendations,
  };

  if (profile.crisis) {
    result.crisis_resources = CRISIS_RESOURCES;
  }

  return result;
}
