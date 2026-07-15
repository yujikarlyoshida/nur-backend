import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActivitySuggestion, EmotionalProfile, LocationContext } from '../src/types/index.js';

// activityProvider.service.ts is mocked so this suite runs offline and
// deterministically, the same reasoning as recommendation.service.test.ts
// mocking verse.service/nlp.service/semanticSearch.service.
vi.mock('../src/services/activityProvider.service.js', () => ({
  getNearbyActivities: vi.fn(),
}));

import { getNearbyActivities } from '../src/services/activityProvider.service.js';
import { getActivityRecommendations, scoreActivity } from '../src/services/recommendation.service.js';

function makeSuggestion(overrides: Partial<ActivitySuggestion> = {}): ActivitySuggestion {
  return {
    id: 'test-id',
    name: 'Test venue',
    category: 'calm_nature',
    description: 'A test venue.',
    distance_km: 2,
    is_open_now: true,
    relevance_score: 0,
    source: 'sample',
    ...overrides,
  };
}

function makeProfile(overrides: Partial<EmotionalProfile> = {}): EmotionalProfile {
  return {
    primary_emotion: 'anxiety',
    intensity: 6,
    spiritual_need: 'comfort',
    life_domain: 'general',
    themes: ['tawakkul', 'sabr'],
    reasoning: 'Test profile.',
    crisis: false,
    ...overrides,
  };
}

const testLocation: LocationContext = { latitude: 37.7749, longitude: -122.4194 };

beforeEach(() => {
  vi.mocked(getNearbyActivities).mockReset();
});

describe('scoreActivity (pure scoring function)', () => {
  it('scores a higher-priority category above a lower-priority one, all else equal', () => {
    const categories = ['calm_nature', 'quiet_reflection'] as const;
    const highPriority = scoreActivity(makeSuggestion({ category: 'calm_nature' }), [...categories]);
    const lowPriority = scoreActivity(makeSuggestion({ category: 'quiet_reflection' }), [...categories]);

    expect(highPriority).toBeGreaterThan(lowPriority);
  });

  it('scores an open venue above an otherwise-identical closed one', () => {
    const categories = ['calm_nature'] as const;
    const open = scoreActivity(makeSuggestion({ is_open_now: true }), [...categories]);
    const closed = scoreActivity(makeSuggestion({ is_open_now: false }), [...categories]);

    expect(open).toBeGreaterThan(closed);
  });

  it('scores a closer venue above an otherwise-identical farther one', () => {
    const categories = ['calm_nature'] as const;
    const near = scoreActivity(makeSuggestion({ distance_km: 0.5 }), [...categories]);
    const far = scoreActivity(makeSuggestion({ distance_km: 7.5 }), [...categories]);

    expect(near).toBeGreaterThan(far);
  });

  it('never returns a score outside [0, 1]', () => {
    const score = scoreActivity(
      makeSuggestion({ distance_km: 0, is_open_now: true, category: 'calm_nature' }),
      ['calm_nature'],
    );
    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('does not penalize a venue with unknown open status as heavily as a known-closed one', () => {
    const categories = ['calm_nature'] as const;
    const unknown = scoreActivity(makeSuggestion({ is_open_now: undefined }), [...categories]);
    const closed = scoreActivity(makeSuggestion({ is_open_now: false }), [...categories]);

    expect(unknown).toBeGreaterThan(closed);
  });
});

describe('getActivityRecommendations', () => {
  it('returns activities sorted by relevance score, capped at 6', async () => {
    vi.mocked(getNearbyActivities).mockResolvedValue([
      makeSuggestion({ id: '1', category: 'quiet_reflection', distance_km: 7, is_open_now: false }),
      makeSuggestion({ id: '2', category: 'calm_nature', distance_km: 0.5, is_open_now: true }),
      makeSuggestion({ id: '3', category: 'calm_nature', distance_km: 6, is_open_now: undefined }),
      makeSuggestion({ id: '4', category: 'quiet_reflection', distance_km: 1, is_open_now: true }),
      makeSuggestion({ id: '5', category: 'calm_nature', distance_km: 3, is_open_now: true }),
    ]);

    const result = await getActivityRecommendations(makeProfile(), testLocation);

    expect(result.length).toBeLessThanOrEqual(6);
    // Scores should be in descending order
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i - 1]!.relevance_score).toBeGreaterThanOrEqual(result[i]!.relevance_score);
    }
    // The nearest, open, highest-priority-category venue should win
    expect(result[0]!.id).toBe('2');
  });

  it('returns an empty array when the provider returns nothing', async () => {
    vi.mocked(getNearbyActivities).mockResolvedValue([]);

    const result = await getActivityRecommendations(makeProfile(), testLocation);

    expect(result).toEqual([]);
  });

  it('passes the emotion-appropriate category list to the provider', async () => {
    vi.mocked(getNearbyActivities).mockResolvedValue([]);

    await getActivityRecommendations(makeProfile({ primary_emotion: 'anger' }), testLocation);

    const calledCategories = vi.mocked(getNearbyActivities).mock.calls[0]?.[1];
    expect(calledCategories).toContain('physical_release');
  });
});
