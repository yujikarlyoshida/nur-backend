// ─── Activity Provider Service ─────────────────────────────────────────────────
//
// Given a location and a set of ActivityCategory values, returns nearby
// real-world activity suggestions. Two data sources, same shape as the
// verse RAG layer (embedding.service.ts / semanticSearch.service.ts):
//
//   1. Sample catalog (always available) — a small, hand-written set of
//      activity templates per category (e.g. "K1 Speed" for
//      physical_release, "spa & wellness center" for celebration). Distance
//      is synthesized deterministically from the user's coordinates so the
//      UI has something plausible to render without hitting a paid API.
//
//   2. Google Places Nearby Search (optional) — used automatically when
//      GOOGLE_PLACES_API_KEY is set. Real venues, real hours, real
//      distance. Falls back to the sample catalog on any error (missing
//      key, network failure, quota) so a misconfigured or rate-limited API
//      never breaks the check-in response.
//
// Swapping in a different provider (Yelp Fusion, Foursquare, etc.) later
// means adding a sibling to fetchFromGooglePlaces and branching in
// getNearbyActivities — the rest of the app (recommendation.service.ts,
// the checkin route, the mobile UI) only ever sees ActivitySuggestion[].
//
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';
import type { ActivityCategory, ActivitySuggestion, LocationContext } from '../types/index.js';

const GOOGLE_PLACES_URL = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';

// ─── Sample Catalog ────────────────────────────────────────────────────────────

interface ActivityTemplate {
  name: string;
  description: string;
  /** [openHour, closeHour) in 24h local time, e.g. [9, 21] = 9am-9pm. */
  hours: [number, number];
}

const SAMPLE_CATALOG: Record<ActivityCategory, ActivityTemplate[]> = {
  calm_nature: [
    { name: 'Riverside walking trail', description: 'A quiet path along the water — good for slowing down.', hours: [6, 21] },
    { name: 'Botanical garden', description: 'Green space built for unhurried walking and noticing small things.', hours: [8, 18] },
    { name: 'Public beach access', description: 'Open shoreline, low stimulation, room to breathe.', hours: [0, 24] },
  ],
  physical_release: [
    { name: 'K1 Speed (indoor go-karting)', description: 'High-adrenaline karting — a physical outlet for restless energy.', hours: [11, 23] },
    { name: 'Rock climbing gym', description: 'Problem-solving under physical exertion; hard to think about anything else.', hours: [9, 22] },
    { name: 'Drop-in boxing/kickboxing class', description: 'Structured, supervised way to burn off intensity.', hours: [6, 21] },
  ],
  social_gathering: [
    { name: 'Public grilling/BBQ pits', description: 'Low-pressure way to get people together over food.', hours: [10, 20] },
    { name: 'Board game café', description: 'Social without needing to perform — the game gives you something to do.', hours: [11, 23] },
    { name: 'Community potluck space', description: 'Shared-table gathering spot, often used for iftars and community dinners.', hours: [16, 22] },
  ],
  quiet_reflection: [
    { name: 'Local mosque', description: 'A place to sit, pray, or just be still.', hours: [0, 24] },
    { name: 'Library reading room', description: 'Quiet, no obligation to talk to anyone.', hours: [9, 20] },
    { name: 'Journaling café corner', description: 'A café with a quiet corner good for writing things out.', hours: [7, 21] },
  ],
  adventure: [
    { name: 'Hiking trailhead', description: 'A new trail — something to look forward to and plan around.', hours: [6, 19] },
    { name: 'Trampoline park', description: 'Physically novel, hard to overthink while doing it.', hours: [10, 21] },
    { name: 'Kayak/paddleboard rental', description: 'New skill, open water, a change of scenery.', hours: [8, 18] },
  ],
  creative_or_learning: [
    { name: 'Pottery/paint studio drop-in class', description: 'Hands-on, unhurried, produces something at the end.', hours: [10, 21] },
    { name: 'Independent bookstore', description: 'Browsing with no agenda — good for a wandering mind.', hours: [9, 21] },
  ],
  service_or_community: [
    { name: 'Local food bank volunteer shift', description: 'Structured, useful, outward-facing — a break from your own head.', hours: [9, 17] },
    { name: 'Community center event board', description: 'Drop-in classes and meetups happening nearby this week.', hours: [9, 20] },
  ],
  celebration: [
    { name: 'Rooftop dinner spot', description: 'Worth marking the moment somewhere with a view.', hours: [17, 23] },
    { name: 'Spa & wellness center', description: 'A deliberate, unhurried way to celebrate feeling good.', hours: [9, 20] },
    { name: 'K1 Speed (indoor go-karting)', description: 'A high-energy way to celebrate with people.', hours: [11, 23] },
  ],
};

/**
 * Deterministically derives a plausible "nearby" distance (0.3km-8km) from
 * the user's coordinates and a venue name, so the same location + category
 * always renders the same sample distances instead of jumping around on
 * every request. This is explicitly synthetic — see `source: 'sample'` on
 * the returned suggestion.
 */
function pseudoDistanceKm(location: LocationContext, seed: string): number {
  const raw = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)},${seed}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  const fraction = (hash % 1000) / 1000; // 0-0.999
  return Math.round((0.3 + fraction * 7.7) * 10) / 10; // 0.3km - 8.0km
}

function isOpenNow(hours: [number, number], localHour: number): boolean {
  const [open, close] = hours;
  if (close === 24 && open === 0) return true;
  return localHour >= open && localHour < close;
}

/**
 * Returns sample-catalog activity suggestions for the given categories.
 * Always succeeds — this is the deterministic fallback the rest of the app
 * can rely on with zero configuration, same role the curated verse taxonomy
 * plays for recommendations.
 */
function getSampleActivities(
  location: LocationContext,
  categories: ActivityCategory[],
  localHour: number,
): ActivitySuggestion[] {
  const suggestions: ActivitySuggestion[] = [];

  for (const category of categories) {
    for (const template of SAMPLE_CATALOG[category]) {
      const distance_km = pseudoDistanceKm(location, template.name);
      const open = isOpenNow(template.hours, localHour);
      suggestions.push({
        id: randomUUID(),
        name: template.name,
        category,
        description: template.description,
        distance_km,
        typical_hours: formatHours(template.hours),
        is_open_now: open,
        relevance_score: 0, // scored by recommendation.service.ts
        source: 'sample',
      });
    }
  }

  return suggestions;
}

function formatHours([open, close]: [number, number]): string {
  if (open === 0 && close === 24) return 'Open 24 hours';
  const fmt = (h: number) => {
    const period = h >= 12 ? 'pm' : 'am';
    const displayHour = h % 12 === 0 ? 12 : h % 12;
    return `${displayHour}${period}`;
  };
  return `${fmt(open)}–${fmt(close)}`;
}

// ─── Google Places (optional live provider) ────────────────────────────────────

interface GooglePlacesResult {
  results: Array<{
    place_id: string;
    name: string;
    vicinity?: string;
    geometry: { location: { lat: number; lng: number } };
    opening_hours?: { open_now?: boolean };
    types?: string[];
  }>;
  status: string;
}

// Rough keyword per category — Google Places Nearby Search matches on
// free-text `keyword` in addition to `type`, so this doesn't need to be exact.
const CATEGORY_KEYWORDS: Record<ActivityCategory, string> = {
  calm_nature: 'park OR trail OR garden',
  physical_release: 'go kart OR climbing gym OR boxing gym',
  social_gathering: 'bbq OR board game cafe OR community potluck',
  quiet_reflection: 'mosque OR library OR quiet cafe',
  adventure: 'hiking trail OR kayak rental OR trampoline park',
  creative_or_learning: 'pottery studio OR paint studio OR bookstore',
  service_or_community: 'volunteer OR community center',
  celebration: 'spa OR rooftop restaurant OR lounge',
};

function haversineKm(a: LocationContext, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.latitude) * Math.PI) / 180;
  const dLng = ((b.lng - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 10) / 10;
}

export function isPlacesProviderConfigured(): boolean {
  return Boolean(process.env['GOOGLE_PLACES_API_KEY']);
}

async function fetchFromGooglePlaces(
  location: LocationContext,
  category: ActivityCategory,
): Promise<ActivitySuggestion[]> {
  const apiKey = process.env['GOOGLE_PLACES_API_KEY'];
  if (!apiKey) return [];

  const params = new URLSearchParams({
    location: `${location.latitude},${location.longitude}`,
    radius: '8000', // meters
    keyword: CATEGORY_KEYWORDS[category],
    key: apiKey,
  });

  const response = await fetch(`${GOOGLE_PLACES_URL}?${params.toString()}`, {
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`Google Places request failed: ${response.status}`);
  }

  const data = (await response.json()) as GooglePlacesResult;

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`Google Places returned status ${data.status}`);
  }

  return (data.results ?? []).slice(0, 5).map((place) => ({
    id: place.place_id,
    name: place.name,
    category,
    description: place.vicinity ?? 'Nearby location',
    distance_km: haversineKm(location, place.geometry.location),
    is_open_now: place.opening_hours?.open_now,
    relevance_score: 0, // scored by recommendation.service.ts
    source: 'google_places' as const,
  }));
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns nearby activity suggestions for the given categories. Tries
 * Google Places first when GOOGLE_PLACES_API_KEY is configured; falls back
 * to the sample catalog on missing config or any error, per-category, so a
 * partial live-API failure still returns useful results.
 */
export async function getNearbyActivities(
  location: LocationContext,
  categories: ActivityCategory[],
  now: Date = new Date(),
): Promise<ActivitySuggestion[]> {
  const localHour = now.getHours();

  if (!isPlacesProviderConfigured()) {
    return getSampleActivities(location, categories, localHour);
  }

  const results: ActivitySuggestion[] = [];
  for (const category of categories) {
    try {
      const live = await fetchFromGooglePlaces(location, category);
      if (live.length > 0) {
        results.push(...live);
        continue;
      }
      results.push(...getSampleActivities(location, [category], localHour));
    } catch (err) {
      console.warn(`[activityProvider] Google Places lookup failed for ${category}, using sample data:`, err);
      results.push(...getSampleActivities(location, [category], localHour));
    }
  }

  return results;
}
