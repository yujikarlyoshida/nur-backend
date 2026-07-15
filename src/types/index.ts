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
  location?: LocationContext;
  /** Hard filter on activity_suggestions — only applies when location is also sent. */
  vibe?: Vibe;
}

export interface CheckinResponse {
  checkin_id: string;
  emotional_profile: EmotionalProfile;
  recommendations: VerseRecommendation[];
  crisis_resources?: CrisisResources;
  activity_suggestions?: ActivitySuggestion[];
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

// ─── Real-World Activity Suggestions ──────────────────────────────────────────
//
// A second recommendation type alongside verses: instead of (or in addition
// to) scripture, suggest a real-world action near the user, matched to their
// emotional state and the time of day. Uses the same "curated taxonomy +
// pluggable live data source" pattern as the verse RAG layer (see
// activityProvider.service.ts) — a hand-built category catalog always works;
// a real places API (Google Places, Yelp, etc.) augments it when configured.

export type ActivityCategory =
  | 'calm_nature' // parks, trails, waterfronts — for anxiety, overwhelm
  | 'physical_release' // go-karting, climbing, boxing — for anger, restlessness
  | 'social_gathering' // grilling spots, cafes, board game venues — for loneliness, gratitude
  | 'quiet_reflection' // mosques, libraries, journaling spaces — for grief, confusion, guilt
  | 'adventure' // hiking, kayaking, trampoline parks — for hope, seeking novelty
  | 'creative_or_learning' // studios, bookstores, classes — for peace, curiosity
  | 'service_or_community' // volunteering, community centers — for disconnection, guilt
  | 'celebration'; // spas, lounges, dinner spots — for joy, gratitude

export interface LocationContext {
  latitude: number;
  longitude: number;
  /** IANA timezone (e.g. "America/Los_Angeles"); falls back to server time if omitted. */
  timezone?: string;
}

// "How busy/energetic" a suggestion is expected to be. Google doesn't
// publish real-time foot-traffic data through its public Places API, so
// this is estimated for free from signals the API does expose — rating,
// review volume, price level, category, and time-of-day — rather than
// requiring a paid third-party foot-traffic service. See
// activityProvider.service.ts's estimateLiveliness() for the heuristic.
export type Vibe = 'quiet' | 'moderate' | 'lively';

export interface ActivitySuggestion {
  id: string;
  name: string;
  category: ActivityCategory;
  description: string;
  /** Straight-line distance from the user's location, in km. */
  distance_km?: number;
  /** Human-readable hours for today, e.g. "9am–9pm". */
  typical_hours?: string;
  is_open_now?: boolean;
  /** Set when today's hours differ from the usual schedule (holiday/special hours). */
  special_hours_today?: boolean;
  vibe?: Vibe;
  rating?: number;
  review_count?: number;
  relevance_score: number;
  /** Where this suggestion came from — lets the UI/analytics distinguish real data from the sample catalog. */
  source: 'sample' | 'google_places';
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

// Note: these are declared with `type`, not `interface`, deliberately.
// TypeScript's generic constraint checking (e.g. `T extends Record<string,
// unknown>`) only recognises plain object *type aliases* as satisfying an
// index-signature constraint — `interface`s are excluded from that implicit
// inference even when structurally identical. Supabase's typed client
// (db/client.ts's `Database` generic) relies on exactly this constraint
// internally, and using `interface` here silently broke `.upsert()` and
// `.rpc()` type-checking (they degraded to accepting `never`). Keep these
// as `type` — see db/client.ts for where this matters.

export type DbUser = {
  id: string;
  email?: string;
  display_name?: string;
  language_preference: string;
  notification_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type DbCheckin = {
  id: string;
  user_id?: string;
  input_type: InputType;
  raw_text_hash?: string;
  emotional_profile: EmotionalProfile;
  language?: string;
  session_id?: string;
  created_at: string;
};

export type DbVerseRecommendation = {
  id: string;
  checkin_id: string;
  verse_key: string;
  personalized_note: string;
  relevance_score: number;
  rank_position: number;
  was_saved: boolean;
  created_at: string;
};

export type DbSavedVerse = {
  id: string;
  user_id: string;
  verse_key: string;
  personal_note?: string;
  tags: string[];
  created_at: string;
};

export type DbJournalEntry = {
  id: string;
  user_id: string;
  checkin_id?: string;
  content_hash: string;
  word_count: number;
  dominant_emotion?: EmotionState;
  created_at: string;
  updated_at: string;
};

export type DbVerseEmotionalTag = {
  id: string;
  verse_key: string;
  emotion: EmotionState;
  theme: string;
  weight: number;
  created_at: string;
};

export type DbVerseEmbedding = {
  verse_key: string;
  surah_number: number;
  ayah_number: number;
  translation: string;
  embedding: number[];
  model: string;
  created_at?: string;
};
