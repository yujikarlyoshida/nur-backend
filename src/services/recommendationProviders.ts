// ─── Recommendation Provider Registry ──────────────────────────────────────
//
// Every "kind of thing we recommend on a check-in" (verses today; activities
// today; something else tomorrow — dhikr reminders, community events,
// whatever) implements this one interface and gets added to
// REGISTERED_PROVIDERS below. checkin.ts doesn't know or care how many
// providers exist or what they compute — it just calls
// runRecommendationProviders(ctx) once and merges whatever comes back.
//
// Two things this buys, beyond tidiness:
//   1. Extensibility — adding a new recommendation type is "write a
//      provider, add it to the array," not "go find every place in the
//      route handler that assembles the response and add another branch."
//   2. Performance — providers that are applicable all run concurrently via
//      Promise.allSettled instead of one `await` after another. Verses and
//      activities used to run sequentially (~2 sequential network round
//      trips); now they run in parallel (~1 round trip's worth of latency).
//      One provider failing (or throwing) never blocks or breaks the others
//      — same fail-soft philosophy as everywhere else in this codebase.
//
// ─────────────────────────────────────────────────────────────────────────────

import type {
  EmotionalProfile,
  VerseRecommendation,
  CrisisResources,
  ActivitySuggestion,
  LocationContext,
  Vibe,
} from '../types/index.js';
import { getRecommendations, getActivityRecommendations } from './recommendation.service.js';

export interface RecommendationContext {
  profile: EmotionalProfile;
  language?: string;
  rawText?: string;
  location?: LocationContext;
  vibe?: Vibe;
  now?: Date;
}

/** The subset of CheckinResponse a provider is allowed to contribute to. */
export interface RecommendationContribution {
  recommendations?: VerseRecommendation[];
  crisis_resources?: CrisisResources;
  activity_suggestions?: ActivitySuggestion[];
}

export interface RecommendationProvider {
  /** Short identifier, used only in logs when a provider fails. */
  name: string;
  /** Whether this provider should run at all for the given context (e.g. activities need a location). */
  isApplicable(ctx: RecommendationContext): boolean;
  /** Does the work; may throw — the runner catches and logs, never lets one provider break the others. */
  run(ctx: RecommendationContext): Promise<RecommendationContribution>;
}

const verseProvider: RecommendationProvider = {
  name: 'verses',
  isApplicable: () => true, // verses are the one recommendation type that's never optional
  async run(ctx) {
    const { recommendations, crisis_resources } = await getRecommendations(
      ctx.profile,
      ctx.language,
      ctx.rawText,
    );
    return { recommendations, crisis_resources };
  },
};

const activityProvider: RecommendationProvider = {
  name: 'activities',
  isApplicable: (ctx) => Boolean(ctx.location),
  async run(ctx) {
    // isApplicable already guarantees ctx.location is set when run() is called.
    const activity_suggestions = await getActivityRecommendations(
      ctx.profile,
      ctx.location as LocationContext,
      ctx.now,
      ctx.vibe,
    );
    return { activity_suggestions };
  },
};

/**
 * The extension point: add a new provider here to introduce a new
 * recommendation type. Nothing else in the request path needs to change.
 */
export const REGISTERED_PROVIDERS: RecommendationProvider[] = [verseProvider, activityProvider];

/**
 * Runs every applicable provider concurrently and merges their
 * contributions into one object. A provider that throws is logged (via the
 * optional `onError` callback — checkin.ts wires this to app.log.warn) and
 * simply contributes nothing, rather than failing the whole check-in.
 */
export async function runRecommendationProviders(
  ctx: RecommendationContext,
  providers: RecommendationProvider[] = REGISTERED_PROVIDERS,
  onError?: (providerName: string, err: unknown) => void,
): Promise<RecommendationContribution> {
  const applicable = providers.filter((p) => p.isApplicable(ctx));

  const settled = await Promise.allSettled(applicable.map((p) => p.run(ctx)));

  const merged: RecommendationContribution = {};
  settled.forEach((result, i) => {
    const provider = applicable[i];
    if (!provider) return;
    if (result.status === 'fulfilled') {
      Object.assign(merged, result.value);
    } else {
      onError?.(provider.name, result.reason);
    }
  });

  return merged;
}
