-- ============================================================================
-- Quran Wellbeing App — PostgreSQL Schema
-- Compatible with Supabase (PostgreSQL 15+)
-- ============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- ENUM TYPES
-- ============================================================================

CREATE TYPE input_type AS ENUM (
  'text',
  'voice_transcript',
  'mood_select'
);

CREATE TYPE emotion_state AS ENUM (
  'anxiety',
  'sadness',
  'anger',
  'loneliness',
  'gratitude',
  'hope',
  'guilt',
  'confusion',
  'peace',
  'overwhelmed',
  'grief',
  'disconnection',
  'joy'
);

CREATE TYPE spiritual_need AS ENUM (
  'comfort',
  'guidance',
  'meaning',
  'forgiveness',
  'gratitude'
);

CREATE TYPE life_domain AS ENUM (
  'general',
  'relationships',
  'work',
  'health',
  'faith',
  'family'
);

-- ============================================================================
-- USERS TABLE
-- Stores optional user profiles. The app supports anonymous usage, so
-- all user-linked tables allow NULL user_id.
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email                 TEXT UNIQUE,
  display_name          TEXT,
  language_preference   TEXT NOT NULL DEFAULT 'en',
  notification_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Index on email for lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- ============================================================================
-- CHECK_INS TABLE
-- Core table that records each emotional check-in session.
-- raw_text is never stored — only a SHA-256 hash for deduplication purposes.
-- The full emotional analysis is stored as JSONB in emotional_profile.
-- ============================================================================

CREATE TABLE IF NOT EXISTS check_ins (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  input_type        input_type NOT NULL,
  raw_text_hash     TEXT,                    -- SHA-256 of original text (privacy)
  emotional_profile JSONB NOT NULL,           -- EmotionalProfile shape
  language          TEXT NOT NULL DEFAULT 'en',
  session_id        TEXT,                     -- Anonymous session tracking
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for user history queries
CREATE INDEX IF NOT EXISTS idx_check_ins_user_id
  ON check_ins (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Index for session-based queries (anonymous users)
CREATE INDEX IF NOT EXISTS idx_check_ins_session_id
  ON check_ins (session_id, created_at DESC)
  WHERE session_id IS NOT NULL;

-- Index for querying by primary emotion (JSONB)
CREATE INDEX IF NOT EXISTS idx_check_ins_primary_emotion
  ON check_ins USING GIN ((emotional_profile -> 'primary_emotion'));

-- ============================================================================
-- VERSE_RECOMMENDATIONS TABLE
-- Records which verses were recommended for each check-in and at what rank.
-- ============================================================================

CREATE TABLE IF NOT EXISTS verse_recommendations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  checkin_id        UUID NOT NULL REFERENCES check_ins(id) ON DELETE CASCADE,
  verse_key         TEXT NOT NULL,            -- e.g. "2:286"
  personalized_note TEXT NOT NULL,
  relevance_score   NUMERIC(4, 3) NOT NULL,   -- 0.000 – 1.000
  rank_position     SMALLINT NOT NULL,        -- 1-indexed rank
  was_saved         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT verse_recommendations_score_range CHECK (
    relevance_score >= 0 AND relevance_score <= 1
  ),
  CONSTRAINT verse_recommendations_rank_positive CHECK (rank_position >= 1)
);

CREATE INDEX IF NOT EXISTS idx_verse_recommendations_checkin
  ON verse_recommendations (checkin_id);

CREATE INDEX IF NOT EXISTS idx_verse_recommendations_verse_key
  ON verse_recommendations (verse_key);

-- ============================================================================
-- SAVED_VERSES TABLE
-- Allows authenticated users to bookmark verses with personal notes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS saved_verses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verse_key     TEXT NOT NULL,
  personal_note TEXT,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT saved_verses_unique_per_user UNIQUE (user_id, verse_key)
);

CREATE INDEX IF NOT EXISTS idx_saved_verses_user_id
  ON saved_verses (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_verses_verse_key
  ON saved_verses (verse_key);

-- GIN index for tag array searches
CREATE INDEX IF NOT EXISTS idx_saved_verses_tags
  ON saved_verses USING GIN (tags);

-- ============================================================================
-- JOURNAL_ENTRIES TABLE
-- Stores user reflection entries (raw content is never stored — only a hash
-- and metadata for privacy).
-- ============================================================================

CREATE TABLE IF NOT EXISTS journal_entries (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checkin_id       UUID REFERENCES check_ins(id) ON DELETE SET NULL,
  content_hash     TEXT NOT NULL,             -- SHA-256 of journal text
  word_count       INTEGER NOT NULL DEFAULT 0,
  dominant_emotion emotion_state,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT journal_entries_word_count_non_negative CHECK (word_count >= 0)
);

CREATE TRIGGER set_journal_entries_updated_at
BEFORE UPDATE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_journal_entries_user_id
  ON journal_entries (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_journal_entries_checkin_id
  ON journal_entries (checkin_id)
  WHERE checkin_id IS NOT NULL;

-- ============================================================================
-- VERSE_EMOTIONAL_TAGS TABLE
-- Semantic mapping between Quran verses and emotional states.
-- Populated via seed data or admin tools.
-- Used for the hybrid retrieval system in recommendation.service.ts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS verse_emotional_tags (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  verse_key  TEXT NOT NULL,
  emotion    emotion_state NOT NULL,
  theme      TEXT NOT NULL,                -- e.g. "tawakkul", "sabr"
  weight     NUMERIC(4, 3) NOT NULL DEFAULT 1.0, -- relevance weight 0–1
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT verse_emotional_tags_unique UNIQUE (verse_key, emotion, theme),
  CONSTRAINT verse_emotional_tags_weight_range CHECK (
    weight >= 0 AND weight <= 1
  )
);

CREATE INDEX IF NOT EXISTS idx_verse_emotional_tags_emotion
  ON verse_emotional_tags (emotion);

CREATE INDEX IF NOT EXISTS idx_verse_emotional_tags_verse_key
  ON verse_emotional_tags (verse_key);

CREATE INDEX IF NOT EXISTS idx_verse_emotional_tags_theme
  ON verse_emotional_tags (theme);

-- ============================================================================
-- SEED: VERSE_EMOTIONAL_TAGS
-- Pre-populate with well-known verses per emotion for cold-start retrieval.
-- ============================================================================

INSERT INTO verse_emotional_tags (verse_key, emotion, theme, weight) VALUES
  -- Anxiety
  ('2:286',  'anxiety',      'tawakkul',   1.0),
  ('13:28',  'anxiety',      'dhikr',      1.0),
  ('65:3',   'anxiety',      'tawakkul',   0.9),
  ('94:5',   'anxiety',      'yaqeen',     0.9),
  ('3:173',  'anxiety',      'tawakkul',   0.8),
  -- Sadness
  ('2:155',  'sadness',      'sabr',       1.0),
  ('2:286',  'sadness',      'rahma',      0.9),
  ('94:5',   'sadness',      'amal',       0.9),
  ('93:3',   'sadness',      'rahma',      0.8),
  ('12:86',  'sadness',      'sabr',       0.8),
  -- Anger
  ('3:134',  'anger',        'hilm',       1.0),
  ('42:37',  'anger',        'afw',        1.0),
  ('7:199',  'anger',        'hilm',       0.9),
  ('41:34',  'anger',        'sabr',       0.8),
  ('2:153',  'anger',        'sabr',       0.8),
  -- Loneliness
  ('2:186',  'loneliness',   'qurb',       1.0),
  ('50:16',  'loneliness',   'uns',        1.0),
  ('58:7',   'loneliness',   'muraqabah',  0.9),
  ('13:28',  'loneliness',   'dhikr',      0.9),
  ('9:40',   'loneliness',   'uns',        0.8),
  -- Gratitude
  ('14:7',   'gratitude',    'shukr',      1.0),
  ('55:13',  'gratitude',    'ni''ma',     1.0),
  ('2:152',  'gratitude',    'dhikr',      0.9),
  ('16:18',  'gratitude',    'ni''ma',     0.9),
  ('31:12',  'gratitude',    'shukr',      0.8),
  -- Hope
  ('39:53',  'hope',         'raja''',     1.0),
  ('94:5',   'hope',         'amal',       1.0),
  ('2:218',  'hope',         'rahma',      0.9),
  ('65:3',   'hope',         'tawakkul',   0.9),
  ('3:139',  'hope',         'amal',       0.8),
  -- Guilt
  ('39:53',  'guilt',        'tawbah',     1.0),
  ('4:110',  'guilt',        'maghfira',   1.0),
  ('66:8',   'guilt',        'inabah',     0.9),
  ('2:222',  'guilt',        'tawbah',     0.9),
  ('25:70',  'guilt',        'maghfira',   0.8),
  -- Confusion
  ('2:2',    'confusion',    'hidayah',    1.0),
  ('17:9',   'confusion',    'hidayah',    1.0),
  ('39:18',  'confusion',    'tafakkur',   0.9),
  ('16:43',  'confusion',    'ilm',        0.9),
  ('4:59',   'confusion',    'hidayah',    0.8),
  -- Peace
  ('13:28',  'peace',        'sakeenah',   1.0),
  ('48:4',   'peace',        'sakeenah',   1.0),
  ('2:112',  'peace',        'tuma''nina', 0.9),
  ('10:62',  'peace',        'sakeenah',   0.9),
  ('89:27',  'peace',        'tuma''nina', 0.8),
  -- Overwhelmed
  ('2:286',  'overwhelmed',  'tayseer',    1.0),
  ('94:5',   'overwhelmed',  'rahma',      1.0),
  ('94:6',   'overwhelmed',  'tayseer',    0.9),
  ('65:7',   'overwhelmed',  'rahma',      0.9),
  ('2:185',  'overwhelmed',  'tayseer',    0.8),
  -- Grief
  ('2:156',  'grief',        'inna_lillahi', 1.0),
  ('2:157',  'grief',        'sabr',        1.0),
  ('93:3',   'grief',        'rahma',       0.9),
  ('2:286',  'grief',        'sabr',        0.8),
  ('94:1',   'grief',        'rahma',       0.8),
  -- Disconnection
  ('2:152',  'disconnection', 'dhikr',      1.0),
  ('50:16',  'disconnection', 'muraqabah',  1.0),
  ('2:186',  'disconnection', 'qurb',       0.9),
  ('57:4',   'disconnection', 'muraqabah',  0.9),
  ('6:103',  'disconnection', 'ihsan',      0.8),
  -- Joy
  ('14:7',   'joy',          'shukr',      1.0),
  ('93:11',  'joy',          'ni''ma',     1.0),
  ('55:13',  'joy',          'hamd',       0.9),
  ('2:152',  'joy',          'dhikr',      0.9),
  ('10:58',  'joy',          'ni''ma',     0.8)

ON CONFLICT (verse_key, emotion, theme) DO NOTHING;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- Enable RLS on all user-linked tables to prevent data leakage.
-- Policies below assume Supabase Auth (JWT-based).
-- ============================================================================

ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_ins           ENABLE ROW LEVEL SECURITY;
ALTER TABLE verse_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_verses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE verse_emotional_tags ENABLE ROW LEVEL SECURITY;

-- Users can only see and edit their own profile
CREATE POLICY users_select_own ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY users_update_own ON users
  FOR UPDATE USING (auth.uid() = id);

-- Check-ins: users see their own, anonymous sessions use session_id
CREATE POLICY check_ins_select_own ON check_ins
  FOR SELECT USING (
    auth.uid() = user_id
    OR user_id IS NULL
  );

CREATE POLICY check_ins_insert_any ON check_ins
  FOR INSERT WITH CHECK (true); -- Allow anonymous inserts

-- Verse recommendations: viewable if you own the check-in
CREATE POLICY verse_recs_select_own ON verse_recommendations
  FOR SELECT USING (
    checkin_id IN (
      SELECT id FROM check_ins WHERE auth.uid() = user_id OR user_id IS NULL
    )
  );

-- Saved verses: users see only their own
CREATE POLICY saved_verses_select_own ON saved_verses
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY saved_verses_insert_own ON saved_verses
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY saved_verses_update_own ON saved_verses
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY saved_verses_delete_own ON saved_verses
  FOR DELETE USING (auth.uid() = user_id);

-- Journal entries: users see only their own
CREATE POLICY journal_entries_select_own ON journal_entries
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY journal_entries_insert_own ON journal_entries
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY journal_entries_update_own ON journal_entries
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY journal_entries_delete_own ON journal_entries
  FOR DELETE USING (auth.uid() = user_id);

-- Verse emotional tags: public read, restricted write
CREATE POLICY verse_tags_select_all ON verse_emotional_tags
  FOR SELECT USING (true);
