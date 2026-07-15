import type { ActivityCategory, EmotionState } from '../types/index.js';

// ─── Activity Taxonomy ─────────────────────────────────────────────────────────
//
// Maps each of the 13 emotional states to an ordered list of ActivityCategory
// values — the categories most likely to help someone feeling that way,
// highest priority first. Mirrors emotionTaxonomy.ts's structure and intent:
// a small, human-reasoned mapping that's always available, regardless of
// whether a live places API is configured (see activityProvider.service.ts).
//
// This is deliberately not a 1:1 mirror of the Quranic emotion taxonomy —
// "what verse addresses this feeling" and "what real-world action helps
// right now" are different questions with different answers. Anger, for
// example, calls for sabr (patience) spiritually, but a physical outlet
// (activityCategory: physical_release) practically.
//
// ─────────────────────────────────────────────────────────────────────────────

// Three categories per emotion (widened from two) for a broader spread of
// suggestions — each list stays ordered by priority, so the scorer in
// recommendation.service.ts still favours the first entries; the third
// category just widens the candidate pool rather than diluting the ranking.
export const ACTIVITY_TAXONOMY: Record<EmotionState, ActivityCategory[]> = {
  anxiety: ['calm_nature', 'quiet_reflection', 'creative_or_learning'],
  sadness: ['social_gathering', 'calm_nature', 'quiet_reflection'],
  anger: ['physical_release', 'adventure', 'calm_nature'],
  loneliness: ['social_gathering', 'service_or_community', 'quiet_reflection'],
  gratitude: ['celebration', 'social_gathering', 'service_or_community'],
  hope: ['adventure', 'creative_or_learning', 'social_gathering'],
  guilt: ['service_or_community', 'quiet_reflection', 'calm_nature'],
  confusion: ['quiet_reflection', 'calm_nature', 'creative_or_learning'],
  peace: ['calm_nature', 'creative_or_learning', 'quiet_reflection'],
  overwhelmed: ['calm_nature', 'quiet_reflection', 'physical_release'],
  grief: ['quiet_reflection', 'social_gathering', 'calm_nature'],
  disconnection: ['social_gathering', 'service_or_community', 'adventure'],
  joy: ['celebration', 'adventure', 'social_gathering'],
};

/**
 * Returns the ordered activity categories for a given emotion.
 */
export function getActivityCategories(emotion: EmotionState): ActivityCategory[] {
  return ACTIVITY_TAXONOMY[emotion];
}
