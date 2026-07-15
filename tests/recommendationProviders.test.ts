import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EmotionalProfile, LocationContext } from '../src/types/index.js';

vi.mock('../src/services/recommendation.service.js', () => ({
  getRecommendations: vi.fn(),
  getActivityRecommendations: vi.fn(),
}));

import { getRecommendations, getActivityRecommendations } from '../src/services/recommendation.service.js';
import {
  runRecommendationProviders,
  REGISTERED_PROVIDERS,
  type RecommendationProvider,
} from '../src/services/recommendationProviders.js';

function makeProfile(): EmotionalProfile {
  return {
    primary_emotion: 'anxiety',
    intensity: 5,
    spiritual_need: 'comfort',
    life_domain: 'general',
    themes: [],
    reasoning: 'test',
    crisis: false,
  };
}

const testLocation: LocationContext = { latitude: 1, longitude: 1 };

beforeEach(() => {
  vi.mocked(getRecommendations).mockReset();
  vi.mocked(getActivityRecommendations).mockReset();
});

describe('REGISTERED_PROVIDERS', () => {
  it('registers exactly the verse and activity providers by default', () => {
    expect(REGISTERED_PROVIDERS.map((p) => p.name).sort()).toEqual(['activities', 'verses']);
  });
});

describe('runRecommendationProviders', () => {
  it('always runs the verse provider, even with no location', async () => {
    vi.mocked(getRecommendations).mockResolvedValue({ recommendations: [] });

    const result = await runRecommendationProviders({ profile: makeProfile() });

    expect(getRecommendations).toHaveBeenCalled();
    expect(getActivityRecommendations).not.toHaveBeenCalled();
    expect(result.recommendations).toEqual([]);
  });

  it('runs the activity provider only when a location is present', async () => {
    vi.mocked(getRecommendations).mockResolvedValue({ recommendations: [] });
    vi.mocked(getActivityRecommendations).mockResolvedValue([]);

    await runRecommendationProviders({ profile: makeProfile(), location: testLocation });

    expect(getActivityRecommendations).toHaveBeenCalled();
  });

  it('merges results from multiple applicable providers', async () => {
    vi.mocked(getRecommendations).mockResolvedValue({ recommendations: [{ verse_key: '2:286' } as any] });
    vi.mocked(getActivityRecommendations).mockResolvedValue([{ id: 'a1' } as any]);

    const result = await runRecommendationProviders({ profile: makeProfile(), location: testLocation });

    expect(result.recommendations).toHaveLength(1);
    expect(result.activity_suggestions).toHaveLength(1);
  });

  it('does not let one provider throwing affect the others (fail-soft)', async () => {
    vi.mocked(getRecommendations).mockRejectedValue(new Error('boom'));
    vi.mocked(getActivityRecommendations).mockResolvedValue([{ id: 'a1' } as any]);

    const onError = vi.fn();
    const result = await runRecommendationProviders(
      { profile: makeProfile(), location: testLocation },
      undefined,
      onError,
    );

    expect(result.recommendations).toBeUndefined();
    expect(result.activity_suggestions).toHaveLength(1);
    expect(onError).toHaveBeenCalledWith('verses', expect.any(Error));
  });

  it('runs applicable providers concurrently, not sequentially', async () => {
    const order: string[] = [];

    const slow: RecommendationProvider = {
      name: 'slow',
      isApplicable: () => true,
      run: async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push('slow-done');
        return {};
      },
    };
    const fast: RecommendationProvider = {
      name: 'fast',
      isApplicable: () => true,
      run: async () => {
        order.push('fast-done');
        return {};
      },
    };

    await runRecommendationProviders({ profile: makeProfile() }, [slow, fast]);

    // If they ran sequentially in array order, slow would always finish
    // before fast starts. Running concurrently, the fast one finishes first.
    expect(order[0]).toBe('fast-done');
  });
});
