import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  DbUser,
  DbCheckin,
  DbVerseRecommendation,
  DbSavedVerse,
  DbJournalEntry,
  DbVerseEmotionalTag,
} from '../types/index.js';

// ─── Database Schema Types ────────────────────────────────────────────────────

export interface Database {
  public: {
    Tables: {
      users: {
        Row: DbUser;
        Insert: Omit<DbUser, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<DbUser, 'id' | 'created_at'>>;
      };
      check_ins: {
        Row: DbCheckin;
        Insert: Omit<DbCheckin, 'id' | 'created_at'>;
        Update: Partial<Omit<DbCheckin, 'id' | 'created_at'>>;
      };
      verse_recommendations: {
        Row: DbVerseRecommendation;
        Insert: Omit<DbVerseRecommendation, 'id' | 'created_at'>;
        Update: Partial<Omit<DbVerseRecommendation, 'id' | 'created_at'>>;
      };
      saved_verses: {
        Row: DbSavedVerse;
        Insert: Omit<DbSavedVerse, 'id' | 'created_at'>;
        Update: Partial<Omit<DbSavedVerse, 'id' | 'created_at'>>;
      };
      journal_entries: {
        Row: DbJournalEntry;
        Insert: Omit<DbJournalEntry, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<DbJournalEntry, 'id' | 'created_at'>>;
      };
      verse_emotional_tags: {
        Row: DbVerseEmotionalTag;
        Insert: Omit<DbVerseEmotionalTag, 'id' | 'created_at'>;
        Update: Partial<Omit<DbVerseEmotionalTag, 'id' | 'created_at'>>;
      };
    };
  };
}

// ─── Supabase Client Singleton ────────────────────────────────────────────────

let _client: SupabaseClient<Database> | null = null;

/**
 * Returns a singleton Supabase client initialised from environment variables.
 * Throws clearly if the required env vars are not set.
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (_client) {
    return _client;
  }

  const supabaseUrl = process.env['SUPABASE_URL'];
  const supabaseAnonKey = process.env['SUPABASE_ANON_KEY'];

  if (!supabaseUrl) {
    throw new Error(
      'Missing SUPABASE_URL environment variable. Check your .env file.',
    );
  }

  if (!supabaseAnonKey) {
    throw new Error(
      'Missing SUPABASE_ANON_KEY environment variable. Check your .env file.',
    );
  }

  _client = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      // We use the anon key for server-side calls on behalf of unauthenticated
      // users; when a user token is available it should be passed per-request.
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        'x-application-name': 'quran-wellbeing-backend',
      },
    },
  });

  return _client;
}

/**
 * Convenience export so callers can do: import { supabase } from '../db/client'
 */
export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    const client = getSupabaseClient();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});
