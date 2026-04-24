// ─── Emotion States ────────────────────────────────────────────────────────────

export type EmotionState =
  | 'anxiety'
  | 'sadness'
  | 'anger'
  | 'loneliness'
  | 'gratitude'
  | 'hope'
  | 'guilt'
  | 'confusion'
  | 'peace'
  | 'overwhelmed'
  | 'grief'
  | 'disconnection'
  | 'joy';

// ─── Input Types ───────────────────────────────────────────────────────────────

export type InputType = 'text' | 'voice_transcript' | 'mood_select';

// ─── Spiritual Need ────────────────────────────────────────────────────────────

export type SpiritualNeed =
  | 'comfort'
  | 'guidance'
  | 'meaning'
  | 'forgiveness'
  | 'gratitude';

// ─── Life Domain ───────────────────────────────────────────────────────────────

export type LifeDomain =
  | 'general'
  | 'relationships'
  | 'work'
  | 'health'
  | 'faith'
  | 'family';

// ─── Tone ──────────────────────────────────────────────────────────────────────

export type Tone = 'comforting' | 'guiding' | 'cautionary' | 'celebrating';

// ─── Emotional Profile ─────────────────────────────────────────────────────────

export interface EmotionalProfile {
  primary_emotion: EmotionState;
  intensity: number; // 1–10
  spiritual_need: SpiritualNeed;
  life_domain: LifeDomain;
  themes: string[];
  reasoning: string;
  crisis?: boolean;
}

// ─── Check-in ─────────────────────────────────────────────────────────────────

export interface CheckinRequest {
  input_type: InputType;
  text?: string;
  mood_selected?: EmotionState;
  language?: string;
}

export interface CheckinResponse {
  checkin_id: string;
  emotional_profile: EmotionalProfile;
  recommendations: VerseRecommendation[];
  crisis_resources?: CrisisResources;
}

// ─── Verse ────────────────────────────────────────────────────────────────────

export interface Verse {
  verse_key: string;
  surah_number: number;
  ayah_number: number;
  arabic_text: string;
  translation: string;
  transliteration?: string;
  tafsir_summary?: string;
}

// ─── Verse Recommendation ─────────────────────────────────────────────────────

export interface VerseRecommendation {
  verse_key: string;
  surah_number: number;
  ayah_number: number;
  arabic_text: string;
  translation: string;
  transliteration?: string;
  personalized_note: string;
  relevance_score: number;
  tafsir_summary?: string;
}

// ─── Crisis Resources ─────────────────────────────────────────────────────────

export interface CrisisHotline {
  name: string;
  number: string;
  available: string;
  country: string;
}

export interface CrisisResources {
  message: string;
  hotlines: CrisisHotline[];
}

// ─── Emotion Taxonomy Entry ───────────────────────────────────────────────────

export interface EmotionTaxonomyEntry {
  emotion: EmotionState;
  arabic_concept: string;
  themes: string[];
  fallback_verse_keys: string[];
  tone: Tone;
  spiritual_need: SpiritualNeed;
}

// ─── Quran.com API Response Types ─────────────────────────────────────────────

export interface QuranComVerseByKey {
  verse: {
    id: number;
    verse_number: number;
    verse_key: string;
    hizb_number: number;
    rub_el_hizb_number: number;
    ruku_number: number;
    manzil_number: number;
    sajdah_number: number | null;
    page_number: number;
    juz_number: number;
    text_uthmani: string;
    translations: Array<{
      id: number;
      resource_id: number;
      text: string;
    }>;
  };
}

export interface QuranComSearchResult {
  search: {
    query: string;
    total_results: number;
    current_page: number;
    total_pages: number;
    results: Array<{
      id: number;
      verse_key: string;
      verse_number: number;
      text: string;
      translations: Array<{
        id: number;
        resource_id: number;
        text: string;
      }>;
    }>;
  };
}

// ─── Supabase Row Types ────────────────────────────────────────────────────────

export interface DbUser {
  id: string;
  email?: string;
  display_name?: string;
  language_preference: string;
  notification_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbCheckin {
  id: string;
  user_id?: string;
  input_type: InputType;
  raw_text_hash?: string;
  emotional_profile: EmotionalProfile;
  language?: string;
  session_id?: string;
  created_at: string;
}

export interface DbVerseRecommendation {
  id: string;
  checkin_id: string;
  verse_key: string;
  personalized_note: string;
  relevance_score: number;
  rank_position: number;
  was_saved: boolean;
  created_at: string;
}

export interface DbSavedVerse {
  id: string;
  user_id: string;
  verse_key: string;
  personal_note?: string;
  tags: string[];
  created_at: string;
}

export interface DbJournalEntry {
  id: string;
  user_id: string;
  checkin_id?: string;
  content_hash: string;
  word_count: number;
  dominant_emotion?: EmotionState;
  created_at: string;
  updated_at: string;
}

export interface DbVerseEmotionalTag {
  id: string;
  verse_key: string;
  emotion: EmotionState;
  theme: string;
  weight: number;
  created_at: string;
}
