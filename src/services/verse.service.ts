import type {
  Verse,
  EmotionState,
  QuranComVerseByKey,
  QuranComSearchResult,
} from '../types/index.js';
import {
  getFallbackVerseKeys,
  EMOTION_TAXONOMY,
} from '../utils/emotionTaxonomy.js';

// ─── Configuration ────────────────────────────────────────────────────────────

function getQuranApiBase(): string {
  return process.env['QURAN_API_BASE'] ?? 'https://api.quran.com/api/v4';
}

// Translation ID 20 = Saheeh International (English) — used as fallback in resolveTranslationId

// ─── In-Memory Verse Cache ────────────────────────────────────────────────────
// Avoids redundant API calls for frequently-accessed verses.

const verseCache = new Map<string, { verse: Verse; cachedAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCachedVerse(key: string): Verse | null {
  const entry = verseCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    verseCache.delete(key);
    return null;
  }
  return entry.verse;
}

function setCachedVerse(key: string, verse: Verse): void {
  verseCache.set(key, { verse, cachedAt: Date.now() });
}

// ─── Parse Verse Key ─────────────────────────────────────────────────────────

function parseVerseKey(verseKey: string): { surah: number; ayah: number } {
  const parts = verseKey.split(':');
  if (parts.length !== 2) {
    throw new Error(`Invalid verse key format: "${verseKey}". Expected "surah:ayah"`);
  }
  const surah = parseInt(parts[0] ?? '', 10);
  const ayah = parseInt(parts[1] ?? '', 10);
  if (isNaN(surah) || isNaN(ayah)) {
    throw new Error(`Invalid verse key numbers: "${verseKey}"`);
  }
  return { surah, ayah };
}

// ─── Strip HTML from Quran.com translations ───────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Map API Response to Verse ────────────────────────────────────────────────

function mapApiVerseToVerse(
  apiVerse: QuranComVerseByKey['verse'],
): Verse {
  const { surah, ayah } = parseVerseKey(apiVerse.verse_key);
  const translationText = apiVerse.translations?.[0]?.text ?? '';

  return {
    verse_key: apiVerse.verse_key,
    surah_number: surah,
    ayah_number: ayah,
    arabic_text: apiVerse.text_uthmani,
    translation: stripHtml(translationText),
  };
}

// ─── Hardcoded Fallback Verse Data ────────────────────────────────────────────
// Used when the Quran.com API is unavailable, ensuring the app never fails silently.

const HARDCODED_VERSES: Record<string, Verse> = {
  '2:286': {
    verse_key: '2:286',
    surah_number: 2,
    ayah_number: 286,
    arabic_text:
      'لَا يُكَلِّفُ ٱللَّهُ نَفْسًا إِلَّا وُسْعَهَا',
    translation:
      'Allah does not burden a soul beyond that it can bear.',
  },
  '94:5': {
    verse_key: '94:5',
    surah_number: 94,
    ayah_number: 5,
    arabic_text: 'فَإِنَّ مَعَ ٱلْعُسْرِ يُسْرًا',
    translation: 'So, surely with hardship comes ease.',
  },
  '94:6': {
    verse_key: '94:6',
    surah_number: 94,
    ayah_number: 6,
    arabic_text: 'إِنَّ مَعَ ٱلْعُسْرِ يُسْرًا',
    translation: 'Surely with that hardship comes more ease.',
  },
  '13:28': {
    verse_key: '13:28',
    surah_number: 13,
    ayah_number: 28,
    arabic_text:
      'أَلَا بِذِكْرِ ٱللَّهِ تَطْمَئِنُّ ٱلْقُلُوبُ',
    translation:
      'Surely in the remembrance of Allah do hearts find comfort.',
  },
  '39:53': {
    verse_key: '39:53',
    surah_number: 39,
    ayah_number: 53,
    arabic_text:
      'قُلْ يَـٰعِبَادِىَ ٱلَّذِينَ أَسْرَفُوا۟ عَلَىٰٓ أَنفُسِهِمْ لَا تَقْنَطُوا۟ مِن رَّحْمَةِ ٱللَّهِ',
    translation:
      'Say, "O My servants who have exceeded the limits against their souls! Do not lose hope in Allah\'s mercy, for Allah certainly forgives all sins."',
  },
  '2:155': {
    verse_key: '2:155',
    surah_number: 2,
    ayah_number: 155,
    arabic_text:
      'وَلَنَبْلُوَنَّكُم بِشَىْءٍ مِّنَ ٱلْخَوْفِ وَٱلْجُوعِ وَنَقْصٍ مِّنَ ٱلْأَمْوَٰلِ وَٱلْأَنفُسِ وَٱلثَّمَرَٰتِ',
    translation:
      'We will certainly test you with a touch of fear and famine and loss of property, life, and crops.',
  },
  '2:156': {
    verse_key: '2:156',
    surah_number: 2,
    ayah_number: 156,
    arabic_text:
      'ٱلَّذِينَ إِذَآ أَصَـٰبَتْهُم مُّصِيبَةٌ قَالُوٓا۟ إِنَّا لِلَّهِ وَإِنَّآ إِلَيْهِ رَٰجِعُونَ',
    translation:
      'Those who, when faced with a calamity, say, "Surely to Allah we belong and to Him we will ˹all˺ return."',
  },
  '2:157': {
    verse_key: '2:157',
    surah_number: 2,
    ayah_number: 157,
    arabic_text:
      'أُو۟لَـٰٓئِكَ عَلَيْهِمْ صَلَوَٰتٌ مِّن رَّبِّهِمْ وَرَحْمَةٌ وَأُو۟لَـٰٓئِكَ هُمُ ٱلْمُهْتَدُونَ',
    translation:
      'It is they who will receive Allah\'s blessings and mercy. And it is they who are ˹rightly˺ guided.',
  },
  '3:139': {
    verse_key: '3:139',
    surah_number: 3,
    ayah_number: 139,
    arabic_text:
      'وَلَا تَهِنُوا۟ وَلَا تَحْزَنُوا۟ وَأَنتُمُ ٱلْأَعْلَوْنَ إِن كُنتُم مُّؤْمِنِينَ',
    translation:
      'Do not waver or grieve, for you will have the upper hand, if you are ˹true˺ believers.',
  },
  '65:3': {
    verse_key: '65:3',
    surah_number: 65,
    ayah_number: 3,
    arabic_text:
      'وَمَن يَتَوَكَّلْ عَلَى ٱللَّهِ فَهُوَ حَسْبُهُۥٓ',
    translation:
      'And whoever puts their trust in Allah, then He ˹alone˺ is sufficient for them.',
  },
  '2:152': {
    verse_key: '2:152',
    surah_number: 2,
    ayah_number: 152,
    arabic_text: 'فَٱذْكُرُونِىٓ أَذْكُرْكُمْ',
    translation: 'So remember Me; I will remember you.',
  },
  '94:1': {
    verse_key: '94:1',
    surah_number: 94,
    ayah_number: 1,
    arabic_text: 'أَلَمْ نَشْرَحْ لَكَ صَدْرَكَ',
    translation: 'Have We not uplifted your heart for you ˹O Prophet˺?',
  },
  '2:186': {
    verse_key: '2:186',
    surah_number: 2,
    ayah_number: 186,
    arabic_text:
      'وَإِذَا سَأَلَكَ عِبَادِى عَنِّى فَإِنِّى قَرِيبٌ',
    translation:
      'When My servants ask you ˹O Prophet˺ about Me: I am truly near.',
  },
  '50:16': {
    verse_key: '50:16',
    surah_number: 50,
    ayah_number: 16,
    arabic_text:
      'وَنَحْنُ أَقْرَبُ إِلَيْهِ مِنْ حَبْلِ ٱلْوَرِيدِ',
    translation: 'And We are closer to them than their jugular vein.',
  },
  '14:7': {
    verse_key: '14:7',
    surah_number: 14,
    ayah_number: 7,
    arabic_text:
      'لَئِن شَكَرْتُمْ لَأَزِيدَنَّكُمْ',
    translation:
      'If you are grateful, I will certainly give you more.',
  },
  '3:134': {
    verse_key: '3:134',
    surah_number: 3,
    ayah_number: 134,
    arabic_text:
      'ٱلَّذِينَ يُنفِقُونَ فِى ٱلسَّرَّآءِ وَٱلضَّرَّآءِ وَٱلْكَـٰظِمِينَ ٱلْغَيْظَ وَٱلْعَافِينَ عَنِ ٱلنَّاسِ',
    translation:
      'Those who donate in prosperity and adversity, control their anger, and pardon others.',
  },
};

// ─── Main Service Functions ───────────────────────────────────────────────────

/**
 * Fetch a single verse by its key (e.g. "2:286").
 * Tries the Quran.com API first; falls back to hardcoded data if unavailable.
 */
export async function getVerseByKey(
  verseKey: string,
  language?: string,
): Promise<Verse> {
  const cacheKey = `${verseKey}:${language ?? 'en'}`;

  const cached = getCachedVerse(cacheKey);
  if (cached) return cached;

  // Validate format before making API call
  parseVerseKey(verseKey); // throws if invalid

  const base = getQuranApiBase();
  const translationId = resolveTranslationId(language);
  const url = `${base}/verses/by_key/${verseKey}?translations=${translationId}&fields=text_uthmani`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'QuranWellbeingApp/1.0',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new Error(`Quran API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as QuranComVerseByKey;
    const verse = mapApiVerseToVerse(data.verse);

    setCachedVerse(cacheKey, verse);
    return verse;
  } catch (err) {
    console.warn(`[verse.service] Failed to fetch verse ${verseKey} from API:`, err);

    // Return hardcoded fallback if available
    const fallback = HARDCODED_VERSES[verseKey];
    if (fallback) return fallback;

    // Last resort: return a minimal placeholder
    const { surah, ayah } = parseVerseKey(verseKey);
    return {
      verse_key: verseKey,
      surah_number: surah,
      ayah_number: ayah,
      arabic_text: '',
      translation: `[Verse ${verseKey} — translation unavailable]`,
    };
  }
}

/**
 * Search verses by query string using Quran.com API.
 */
export async function searchVerses(
  query: string,
  language?: string,
): Promise<Verse[]> {
  if (!query || query.trim().length < 2) {
    return [];
  }

  const base = getQuranApiBase();
  const translationId = resolveTranslationId(language);
  const encodedQuery = encodeURIComponent(query.trim());
  const url = `${base}/search?q=${encodedQuery}&size=10&language=${language ?? 'en'}&translations=${translationId}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'QuranWellbeingApp/1.0',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Quran search API error: ${response.status}`);
    }

    const data = (await response.json()) as QuranComSearchResult;
    const results = data.search?.results ?? [];

    return results.map((result) => {
      const { surah, ayah } = parseVerseKey(result.verse_key);
      const translationText = result.translations?.[0]?.text ?? result.text ?? '';
      return {
        verse_key: result.verse_key,
        surah_number: surah,
        ayah_number: ayah,
        arabic_text: result.text,
        translation: stripHtml(translationText),
      };
    });
  } catch (err) {
    console.warn('[verse.service] Search failed:', err);
    return [];
  }
}

/**
 * Returns curated fallback verses for a given emotion state.
 * Fetches from Quran.com API in parallel; falls back to hardcoded data.
 */
export async function getVersesByEmotion(
  emotion: EmotionState,
  language?: string,
): Promise<Verse[]> {
  const verseKeys = getFallbackVerseKeys(emotion);

  const versePromises = verseKeys.map((key) =>
    getVerseByKey(key, language).catch((err) => {
      console.warn(`[verse.service] Could not fetch verse ${key}:`, err);
      return null;
    }),
  );

  const results = await Promise.all(versePromises);
  return results.filter((v): v is Verse => v !== null);
}

/**
 * Fetches multiple verses by their keys in parallel.
 */
export async function getVersesByKeys(
  verseKeys: string[],
  language?: string,
): Promise<Verse[]> {
  const unique = [...new Set(verseKeys)];
  const promises = unique.map((key) =>
    getVerseByKey(key, language).catch(() => null),
  );
  const results = await Promise.all(promises);
  return results.filter((v): v is Verse => v !== null);
}

// ─── Translation ID Resolver ─────────────────────────────────────────────────

/**
 * Maps a language code to a Quran.com translation resource ID.
 * Falls back to English (131) for unsupported languages.
 */
function resolveTranslationId(language?: string): number {
  const map: Record<string, number> = {
    en: 20,    // Saheeh International (English)
    ar: 0,     // Arabic (no translation needed)
    ur: 158,   // Mufti Taqi Usmani (Urdu)
    fr: 31,    // Muhammad Hamidullah (French)
    de: 27,    // Abu Rida Muhammad ibn Ahmad (German)
    es: 83,    // Muhammad Isa Garcia (Spanish)
    id: 33,    // Indonesian Ministry of Religion
    tr: 77,    // Diyanet Vakfı (Turkish)
    bn: 120,   // Muhiuddin Khan (Bengali)
    ms: 39,    // Abdullah Muhammad Basmeih (Malay)
    ru: 79,    // Elmir Kuliev (Russian)
    zh: 109,   // Ma Jian (Chinese)
  };

  const lang = (language ?? 'en').toLowerCase().split('-')[0] ?? 'en';
  return map[lang] ?? 131;
}

/**
 * Returns Quran theme information for a given emotion, for use in metadata.
 */
export function getThemesForEmotion(emotion: EmotionState): string[] {
  return EMOTION_TAXONOMY[emotion].themes;
}
