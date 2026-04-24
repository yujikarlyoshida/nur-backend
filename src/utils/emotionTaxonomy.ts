import type { EmotionState, EmotionTaxonomyEntry } from '../types/index.js';

// ─── Emotion Taxonomy ─────────────────────────────────────────────────────────
//
// Maps each of the 13 emotional states to:
//   - arabic_concept  : the Quranic/Islamic concept that addresses this emotion
//   - themes          : relevant Quranic themes (Arabic terminology)
//   - fallback_verse_keys : 3-5 well-known ayahs used when the AI service is unavailable
//   - tone            : how the response should feel
//   - spiritual_need  : what the person most needs spiritually
//
// ─────────────────────────────────────────────────────────────────────────────

export const EMOTION_TAXONOMY: Record<EmotionState, EmotionTaxonomyEntry> = {
  anxiety: {
    emotion: 'anxiety',
    arabic_concept: 'Tawakkul (توكل) — Reliance on Allah',
    themes: ['tawakkul', 'sabr', 'dhikr', 'yaqeen', 'rahma'],
    fallback_verse_keys: ['2:286', '13:28', '65:3', '94:5', '3:173'],
    tone: 'comforting',
    spiritual_need: 'comfort',
  },

  sadness: {
    emotion: 'sadness',
    arabic_concept: 'Sabr (صبر) — Patient Perseverance',
    themes: ['sabr', 'rahma', 'du\'a', 'tawakkul', 'amal'],
    fallback_verse_keys: ['2:155', '2:286', '94:5', '93:3', '12:86'],
    tone: 'comforting',
    spiritual_need: 'comfort',
  },

  anger: {
    emotion: 'anger',
    arabic_concept: 'Hilm (حلم) — Forbearance and Self-Control',
    themes: ['hilm', 'afw', 'sabr', 'tawadu', 'istighfar'],
    fallback_verse_keys: ['3:134', '42:37', '7:199', '41:34', '2:153'],
    tone: 'guiding',
    spiritual_need: 'guidance',
  },

  loneliness: {
    emotion: 'loneliness',
    arabic_concept: 'Uns (أنس) — Intimacy with Allah',
    themes: ['uns', 'dhikr', 'qurb', 'tawakkul', 'du\'a'],
    fallback_verse_keys: ['2:186', '50:16', '58:7', '13:28', '9:40'],
    tone: 'comforting',
    spiritual_need: 'comfort',
  },

  gratitude: {
    emotion: 'gratitude',
    arabic_concept: 'Shukr (شكر) — Gratitude to Allah',
    themes: ['shukr', 'ni\'ma', 'hamd', 'tafakkur', 'dhikr'],
    fallback_verse_keys: ['14:7', '55:13', '2:152', '16:18', '31:12'],
    tone: 'celebrating',
    spiritual_need: 'gratitude',
  },

  hope: {
    emotion: 'hope',
    arabic_concept: 'Raja\' (رجاء) — Hope in Allah\'s Mercy',
    themes: ['raja\'', 'rahma', 'amal', 'hidayah', 'tawakkul'],
    fallback_verse_keys: ['39:53', '94:5', '2:218', '65:3', '3:139'],
    tone: 'celebrating',
    spiritual_need: 'comfort',
  },

  guilt: {
    emotion: 'guilt',
    arabic_concept: 'Tawbah (توبة) — Sincere Repentance',
    themes: ['tawbah', 'maghfira', 'rahma', 'istighfar', 'inabah'],
    fallback_verse_keys: ['39:53', '4:110', '66:8', '2:222', '25:70'],
    tone: 'guiding',
    spiritual_need: 'forgiveness',
  },

  confusion: {
    emotion: 'confusion',
    arabic_concept: 'Hidayah (هداية) — Divine Guidance',
    themes: ['hidayah', 'tafakkur', 'ilm', 'tawakkul', 'du\'a'],
    fallback_verse_keys: ['2:2', '17:9', '39:18', '16:43', '4:59'],
    tone: 'guiding',
    spiritual_need: 'guidance',
  },

  peace: {
    emotion: 'peace',
    arabic_concept: 'Sakeenah (سكينة) — Tranquility from Allah',
    themes: ['sakeenah', 'dhikr', 'tuma\'nina', 'shukr', 'tawakkul'],
    fallback_verse_keys: ['13:28', '48:4', '2:112', '10:62', '89:27'],
    tone: 'celebrating',
    spiritual_need: 'gratitude',
  },

  overwhelmed: {
    emotion: 'overwhelmed',
    arabic_concept: 'Tayseer (تيسير) — Allah\'s Facilitation',
    themes: ['tayseer', 'tawakkul', 'sabr', 'rahma', 'du\'a'],
    fallback_verse_keys: ['2:286', '94:5', '94:6', '65:7', '2:185'],
    tone: 'comforting',
    spiritual_need: 'comfort',
  },

  grief: {
    emotion: 'grief',
    arabic_concept: 'Inna Lillahi (إنا لله) — Return to Allah',
    themes: ['inna_lillahi', 'sabr', 'rahma', 'akhira', 'du\'a'],
    fallback_verse_keys: ['2:156', '2:157', '93:3', '2:286', '94:1'],
    tone: 'comforting',
    spiritual_need: 'meaning',
  },

  disconnection: {
    emotion: 'disconnection',
    arabic_concept: 'Muraqabah (مراقبة) — Awareness of Allah\'s Presence',
    themes: ['muraqabah', 'dhikr', 'ihsan', 'tawbah', 'qurb'],
    fallback_verse_keys: ['2:152', '50:16', '2:186', '57:4', '6:103'],
    tone: 'guiding',
    spiritual_need: 'guidance',
  },

  joy: {
    emotion: 'joy',
    arabic_concept: 'Farh (فرح) — Gratitude and Praise',
    themes: ['shukr', 'hamd', 'ni\'ma', 'tafakkur', 'dhikr'],
    fallback_verse_keys: ['14:7', '93:11', '55:13', '2:152', '10:58'],
    tone: 'celebrating',
    spiritual_need: 'gratitude',
  },
};

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Returns the taxonomy entry for a given emotion state.
 */
export function getEmotionEntry(emotion: EmotionState): EmotionTaxonomyEntry {
  return EMOTION_TAXONOMY[emotion];
}

/**
 * Returns the fallback verse keys for a given emotion.
 */
export function getFallbackVerseKeys(emotion: EmotionState): string[] {
  return EMOTION_TAXONOMY[emotion].fallback_verse_keys;
}

/**
 * Returns the Quranic themes associated with a given emotion.
 */
export function getEmotionThemes(emotion: EmotionState): string[] {
  return EMOTION_TAXONOMY[emotion].themes;
}

/**
 * Returns all 13 emotion states.
 */
export function getAllEmotions(): EmotionState[] {
  return Object.keys(EMOTION_TAXONOMY) as EmotionState[];
}

/**
 * Well-known crisis verse — always included when crisis signals detected.
 * 39:53 — "Do not despair of the mercy of Allah"
 */
export const CRISIS_VERSE_KEY = '39:53';

/**
 * Verses related to seeking help and not giving up — secondary crisis verses.
 */
export const CRISIS_SUPPORT_VERSE_KEYS = ['2:286', '94:5', '3:139', '13:28'];
