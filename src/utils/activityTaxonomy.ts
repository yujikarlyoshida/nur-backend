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

export const ACTIVITY_TAXONOMY: Record<EmotionState, ActivityCategory[]> = {
  anxiety: ['calm_nature', 'quiet_reflection'],
  sadness: ['social_gathering', 'calm_nature'],
  anger: ['physical_release', 'adventure'],
  loneliness: ['social_gathering', 'service_or_community'],
  gratitude: ['celebration', 'social_gathering'],
  hope: ['adventure', 'creative_or_learning'],
  guilt: ['service_or_community', 'quiet_reflection'],
  confusion: ['quiet_reflection', 'calm_nature'],
  peace: ['calm_nature', 'creative_or_learning'],
  overwhelmed: ['calm_nature', 'quiet_reflection'],
  grief: ['quiet_reflection', 'social_gathering'],
  disconnection: ['social_gathering', 'service_or_community'],
  joy: ['celebration', 'adventure'],
};

/**
 * Returns the ordered activity categories for a given emotion.
 */
export function getActivityCategories(emotion: EmotionState): ActivityCategory[] {
  return ACTIVITY_TAXONOMY[emotion];
}
