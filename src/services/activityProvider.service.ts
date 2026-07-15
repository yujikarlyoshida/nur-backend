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
//   2. Google Places (optional) — used automatically when
//      GOOGLE_PLACES_API_KEY is set. Real venues, real distance, and (via a
//      follow-up Place Details call per result) real weekly + holiday
//      hours. Falls back to the sample catalog on any error (missing key,
//      network failure, quota) so a misconfigured or rate-limited API
//      never breaks the check-in response.
//
// A note on "foot traffic": Google does not expose real-time or predicted
// busyness through its public Places API (the "Popular times" graph you
// see on Google Maps isn't part of the API surface — that would require a
// paid third-party service like BestTime.app). Instead, `vibe` (quiet /
// moderate / lively) is *estimated* from signals the API does provide —
// category, rating, review volume, price level, and time of day — via
// estimateVibe() below. It's a heuristic, not a measurement, and is
// labelled as such in the UI.
//
// A note on halal filtering: every suggestion this service returns — sample
// or live — is filtered to be halal-conscious by construction. Two layers,
// applied unconditionally (this is not a togglable preference):
//   1. Place `types` that are inherently non-halal (bar, night_club,
//      liquor_store, casino) are hard-excluded before anything else runs.
//   2. A name-keyword blocklist (isHalalExcluded()) catches venues Google's
//      `types` taxonomy doesn't reliably flag — e.g. a "restaurant"-typed
//      pork BBQ joint, a "lounge" that's really a bar. Food-adjacent
//      category searches (social_gathering, celebration) also bias their
//      keyword query toward "halal restaurant" so live results skew toward
//      halal-friendly venues in the first place, not just away from
//      excluded ones.
// This is a best-effort filter, not a certification check — Google doesn't
// expose halal-certification data, so nothing here can *guarantee* a venue
// is halal-certified. See the README for this caveat and how to extend the
// blocklist.
//
// A note on time-based stress reduction (traffic + parking): the whole
// point of this feature is to reduce stress, not add a stressful drive on
// top of it. Two more signals per suggestion, one real and one estimated:
//   - `travel_time_minutes` / `traffic_delay_minutes` are REAL, current
//     driving time and traffic delay from Google's Distance Matrix API
//     (departure_time=now, traffic_model=best_guess) — genuine traffic
//     data, not a heuristic, when GOOGLE_PLACES_API_KEY's project also has
//     the Distance Matrix API enabled.
//   - `parking_difficulty` IS a heuristic, same caveat as `vibe`: there is
//     no free public API for real-time parking-spot availability. It's
//     estimated from category, current time (rush hour / weekend evening),
//     review volume, and price level — see estimateParkingDifficulty().
// Both feed into scoreActivity() in recommendation.service.ts so a
// high-traffic, hard-to-park suggestion ranks below an equally relevant one
// that's easier to actually get to right now.
//
// Swapping in a different provider (Yelp Fusion, Foursquare, etc.) later
// means adding a sibling to fetchFromGooglePlaces and branching in
// getNearbyActivities — the rest of the app (recommendation.service.ts,
// the checkin route, the mobile UI) only ever sees ActivitySuggestion[].
//
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';
import type {
  ActivityCategory,
  ActivitySuggestion,
  LocationContext,
  ParkingDifficulty,
  Vibe,
} from '../types/index.js';

const GOOGLE_PLACES_NEARBY_URL = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
const GOOGLE_PLACES_DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';
const GOOGLE_DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';

// ─── Sample Catalog ────────────────────────────────────────────────────────────

interface ActivityTemplate {
  name: string;
  description: string;
  /** [openHour, closeHour) in 24h local time, e.g. [9, 21] = 9am-9pm. */
  hours: [number, number];
  /** Baseline vibe for this kind of place, before any time-of-day adjustment. */
  baseVibe: Vibe;
}

const SAMPLE_CATALOG: Record<ActivityCategory, ActivityTemplate[]> = {
  calm_nature: [
    { name: 'Riverside walking trail', description: 'A quiet path along the water — good for slowing down.', hours: [6, 21], baseVibe: 'quiet' },
    { name: 'Botanical garden', description: 'Green space built for unhurried walking and noticing small things.', hours: [8, 18], baseVibe: 'quiet' },
    { name: 'Public beach access', description: 'Open shoreline, low stimulation, room to breathe.', hours: [0, 24], baseVibe: 'quiet' },
  ],
  physical_release: [
    { name: 'K1 Speed (indoor go-karting)', description: 'High-adrenaline karting — a physical outlet for restless energy.', hours: [11, 23], baseVibe: 'lively' },
    { name: 'Rock climbing gym', description: 'Problem-solving under physical exertion; hard to think about anything else.', hours: [9, 22], baseVibe: 'moderate' },
    { name: 'Drop-in boxing/kickboxing class', description: 'Structured, supervised way to burn off intensity.', hours: [6, 21], baseVibe: 'lively' },
  ],
  social_gathering: [
    { name: 'Public grilling/BBQ pits', description: 'Low-pressure way to get people together over food.', hours: [10, 20], baseVibe: 'lively' },
    { name: 'Board game café', description: 'Social without needing to perform — the game gives you something to do.', hours: [11, 23], baseVibe: 'moderate' },
    { name: 'Community potluck space', description: 'Shared-table gathering spot, often used for iftars and community dinners.', hours: [16, 22], baseVibe: 'lively' },
  ],
  quiet_reflection: [
    { name: 'Local mosque', description: 'A place to sit, pray, or just be still.', hours: [0, 24], baseVibe: 'quiet' },
    { name: 'Library reading room', description: 'Quiet, no obligation to talk to anyone.', hours: [9, 20], baseVibe: 'quiet' },
    { name: 'Journaling café corner', description: 'A café with a quiet corner good for writing things out.', hours: [7, 21], baseVibe: 'quiet' },
  ],
  adventure: [
    { name: 'Hiking trailhead', description: 'A new trail — something to look forward to and plan around.', hours: [6, 19], baseVibe: 'moderate' },
    { name: 'Trampoline park', description: 'Physically novel, hard to overthink while doing it.', hours: [10, 21], baseVibe: 'lively' },
    { name: 'Kayak/paddleboard rental', description: 'New skill, open water, a change of scenery.', hours: [8, 18], baseVibe: 'moderate' },
  ],
  creative_or_learning: [
    { name: 'Pottery/paint studio drop-in class', description: 'Hands-on, unhurried, produces something at the end.', hours: [10, 21], baseVibe: 'moderate' },
    { name: 'Independent bookstore', description: 'Browsing with no agenda — good for a wandering mind.', hours: [9, 21], baseVibe: 'quiet' },
  ],
  service_or_community: [
    { name: 'Local food bank volunteer shift', description: 'Structured, useful, outward-facing — a break from your own head.', hours: [9, 17], baseVibe: 'moderate' },
    { name: 'Community center event board', description: 'Drop-in classes and meetups happening nearby this week.', hours: [9, 20], baseVibe: 'moderate' },
  ],
  celebration: [
    { name: 'Halal rooftop dinner spot', description: 'Worth marking the moment somewhere with a view — look for a halal-certified or halal-friendly menu.', hours: [17, 23], baseVibe: 'lively' },
    { name: 'Spa & wellness center', description: 'A deliberate, unhurried way to celebrate feeling good.', hours: [9, 20], baseVibe: 'quiet' },
    { name: 'K1 Speed (indoor go-karting)', description: 'A high-energy way to celebrate with people.', hours: [11, 23], baseVibe: 'lively' },
  ],
};

// All sample-catalog entries above are, by construction, alcohol-free,
// non-nightlife venues (parks, mosques, studios, halal dining, etc.) — the
// hand-written fallback needs no runtime filtering. Live Google Places
// results do, since they're arbitrary real-world venues — see
// isHalalExcluded() below.

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
 * Nudges a baseline vibe by time of day — a place that's normally
 * "moderate" tends to feel livelier on a weekend evening and quieter first
 * thing in the morning. Applied to both the sample catalog and the Google
 * Places heuristic so the two sources behave consistently.
 */
function adjustVibeForTime(base: Vibe, localHour: number, dayOfWeek: number): Vibe {
  const isEvening = localHour >= 17 && localHour <= 22;
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isEarlyOrLate = localHour < 8 || localHour >= 22;

  if (base === 'moderate' && isEvening && isWeekend) return 'lively';
  if (base === 'lively' && isEarlyOrLate) return 'moderate';
  if (base === 'moderate' && isEarlyOrLate) return 'quiet';
  return base;
}

// Baseline parking difficulty per category — dedicated-lot venues (parks,
// mosques, trailheads) default to 'easy'; dense commercial/dining venues
// default harder. Same role as CATEGORY_BASE_VIBE, shared by both the
// sample catalog and the Google Places heuristic (estimateParkingDifficulty)
// so the two sources behave consistently.
const CATEGORY_BASE_PARKING: Record<ActivityCategory, ParkingDifficulty> = {
  calm_nature: 'easy',
  physical_release: 'moderate',
  social_gathering: 'moderate',
  quiet_reflection: 'easy',
  adventure: 'easy',
  creative_or_learning: 'moderate',
  service_or_community: 'moderate',
  celebration: 'hard',
};

/**
 * Nudges a baseline parking difficulty by time of day — rush hour and
 * weekend evenings make parking harder everywhere, not just at inherently
 * hard-to-park venues. Mirrors adjustVibeForTime's shape.
 */
function adjustParkingForTime(base: ParkingDifficulty, localHour: number, dayOfWeek: number): ParkingDifficulty {
  const isRushHour = (localHour >= 7 && localHour < 9) || (localHour >= 16 && localHour < 19);
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isWeekendEvening = isWeekend && localHour >= 17 && localHour <= 22;

  if ((isRushHour || isWeekendEvening) && base === 'moderate') return 'hard';
  if ((isRushHour || isWeekendEvening) && base === 'easy') return 'moderate';
  return base;
}

/**
 * Deterministic stand-in for traffic delay in the sample catalog — 0
 * outside rush hour, otherwise a small hash-seeded delay (3-15 min) so the
 * same venue + time always renders the same value instead of jumping
 * around. Real traffic delay (from Google's Distance Matrix API) is only
 * available for live results — see fetchTrafficInfo.
 */
function pseudoTrafficDelayMinutes(seed: string, localHour: number, dayOfWeek: number): number {
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isRushHour = !isWeekend && ((localHour >= 7 && localHour < 9) || (localHour >= 16 && localHour < 19));
  if (!isRushHour) return 0;

  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return 3 + (hash % 13); // 3-15 minutes
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

/**
 * Returns sample-catalog activity suggestions for the given categories.
 * Always succeeds — this is the deterministic fallback the rest of the app
 * can rely on with zero configuration, same role the curated verse taxonomy
 * plays for recommendations.
 */
function getSampleActivities(
  location: LocationContext,
  categories: ActivityCategory[],
  now: Date,
): ActivitySuggestion[] {
  const localHour = now.getHours();
  const dayOfWeek = now.getDay();
  const suggestions: ActivitySuggestion[] = [];

  for (const category of categories) {
    for (const template of SAMPLE_CATALOG[category]) {
      const distance_km = pseudoDistanceKm(location, template.name);
      const open = isOpenNow(template.hours, localHour);
      const traffic_delay_minutes = pseudoTrafficDelayMinutes(template.name, localHour, dayOfWeek);
      // Rough driving-time estimate from distance alone (~25km/h average
      // urban speed) plus the synthetic delay above — consistent in shape
      // with the live path's real Distance Matrix figures, but explicitly
      // synthetic like the rest of the sample catalog.
      const travel_time_minutes = Math.round((distance_km / 25) * 60) + traffic_delay_minutes;
      suggestions.push({
        id: randomUUID(),
        name: template.name,
        category,
        description: template.description,
        distance_km,
        typical_hours: formatHours(template.hours),
        is_open_now: open,
        vibe: adjustVibeForTime(template.baseVibe, localHour, dayOfWeek),
        travel_time_minutes,
        traffic_delay_minutes,
        parking_difficulty: adjustParkingForTime(CATEGORY_BASE_PARKING[category], localHour, dayOfWeek),
        relevance_score: 0, // scored by recommendation.service.ts
        source: 'sample',
      });
    }
  }

  return suggestions;
}

// ─── Google Places (optional live provider) ────────────────────────────────────

interface GooglePlacesNearbyResult {
  results: Array<{
    place_id: string;
    name: string;
    vicinity?: string;
    geometry: { location: { lat: number; lng: number } };
    opening_hours?: { open_now?: boolean };
    types?: string[];
    rating?: number;
    user_ratings_total?: number;
    price_level?: number;
  }>;
  status: string;
}

interface GooglePlaceDetailsResult {
  result?: {
    opening_hours?: { weekday_text?: string[] };
    current_opening_hours?: { weekday_text?: string[] };
  };
  status: string;
}

// Rough keyword per category — Google Places Nearby Search matches on
// free-text `keyword` in addition to `type`, so this doesn't need to be exact.
// Food-adjacent categories (social_gathering, celebration) bias the query
// toward "halal" so live results skew halal-friendly from the start, on top
// of the hard exclusion filtering applied to every result regardless of
// category — see isHalalExcluded() and the file header note on halal
// filtering.
const CATEGORY_KEYWORDS: Record<ActivityCategory, string> = {
  calm_nature: 'park OR trail OR garden',
  physical_release: 'go kart OR climbing gym OR boxing gym',
  social_gathering: 'halal restaurant OR bbq OR board game cafe OR community potluck',
  quiet_reflection: 'mosque OR library OR quiet cafe',
  adventure: 'hiking trail OR kayak rental OR trampoline park',
  creative_or_learning: 'pottery studio OR paint studio OR bookstore',
  service_or_community: 'volunteer OR community center',
  celebration: 'halal restaurant OR spa OR rooftop dining',
};

// Place `types` (Google's fixed taxonomy) that are always excluded, in every
// category, regardless of emotion or vibe filter — these are never
// halal-friendly venues by definition.
const EXCLUDED_PLACE_TYPES = new Set(['bar', 'night_club', 'liquor_store', 'casino']);

// Name-based fallback filter: Google's `types` field doesn't reliably flag
// every non-halal venue (a "restaurant"-typed pork BBQ joint, a "lounge"
// that's actually a bar), so this catches common non-halal signals in the
// venue name as a second layer. Word-boundary matched, case-insensitive.
// This is a best-effort heuristic, not a halal-certification check — Google
// doesn't expose certification data. Extend this list if a category of
// false negative shows up in practice.
const EXCLUDED_NAME_PATTERNS: RegExp[] = [
  /\bbars?\b/i,
  /\bpub\b/i,
  /\bnight ?club\b/i,
  /\blounge\b/i,
  /\bbrewery\b/i,
  /\bbrewing\b/i,
  /\bwinery\b/i,
  /\bwine bar\b/i,
  /\bcocktails?\b/i,
  /\bliquors?\b/i,
  /\bdistillery\b/i,
  /\bcasino\b/i,
  /\bstrip club\b/i,
  /\bpork\b/i,
  /\bbacon\b/i,
  /\bham\b/i,
  /\bpig roast\b/i,
  /\bpulled pork\b/i,
  /\bcharcuterie\b/i,
  /\bgelatin\b/i,
];

/**
 * True if a venue should be excluded from recommendations on halal grounds
 * — either its Google `types` include a category that's never halal
 * (bar/night_club/liquor_store/casino), or its name matches a known
 * non-halal signal (alcohol venues, pork-centric food). Applied to every
 * live Google Places result before it's ever scored or returned; there is
 * no configuration to turn this off.
 */
export function isHalalExcluded(name: string, types: string[] | undefined): boolean {
  if (types?.some((t) => EXCLUDED_PLACE_TYPES.has(t))) return true;
  return EXCLUDED_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

// Baseline vibe per category, same intent as the sample catalog's
// per-template baseVibe, used as the starting point for the Google
// Places heuristic before rating/review/price signals adjust it.
const CATEGORY_BASE_VIBE: Record<ActivityCategory, Vibe> = {
  calm_nature: 'quiet',
  physical_release: 'lively',
  social_gathering: 'lively',
  quiet_reflection: 'quiet',
  adventure: 'moderate',
  creative_or_learning: 'moderate',
  service_or_community: 'moderate',
  celebration: 'lively',
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

/**
 * Estimates a vibe from free Places data: a category baseline, nudged by
 * review volume (more reviews ~ more foot traffic historically) and price
 * level (fine-dining-priced venues skew quieter), then adjusted for the
 * current time of day the same way the sample catalog is. This is a
 * heuristic standing in for real foot-traffic data, which Google's public
 * API doesn't expose — see the file header comment.
 */
function estimateVibe(
  category: ActivityCategory,
  now: Date,
  userRatingsTotal?: number,
  priceLevel?: number,
): Vibe {
  let vibe = CATEGORY_BASE_VIBE[category];

  if (userRatingsTotal !== undefined) {
    if (userRatingsTotal > 1000 && vibe === 'moderate') vibe = 'lively';
    if (userRatingsTotal < 50 && vibe === 'moderate') vibe = 'quiet';
  }

  if (priceLevel !== undefined && priceLevel >= 3 && vibe === 'lively') {
    vibe = 'moderate'; // higher-end venues tend to run quieter than volume spots
  }

  return adjustVibeForTime(vibe, now.getHours(), now.getDay());
}

/**
 * Estimates parking difficulty from free Places data: a category baseline
 * (dedicated-lot venues like parks/mosques default easier than dense
 * dining/nightlife-adjacent venues), nudged by review volume and price
 * level (busy, upscale venues tend to sit in denser commercial areas), then
 * adjusted for rush hour / weekend evening the same way vibe is. This is a
 * heuristic — there's no free real-time parking-availability API — see the
 * file header comment.
 */
function estimateParkingDifficulty(
  category: ActivityCategory,
  now: Date,
  userRatingsTotal?: number,
  priceLevel?: number,
): ParkingDifficulty {
  let parking = CATEGORY_BASE_PARKING[category];

  if (userRatingsTotal !== undefined && userRatingsTotal > 1000 && parking === 'moderate') {
    parking = 'hard'; // high review volume ~ popular, likely a denser area
  }
  if (priceLevel !== undefined && priceLevel >= 3 && parking !== 'hard') {
    parking = parking === 'easy' ? 'moderate' : 'hard'; // upscale venues skew urban/dense
  }

  return adjustParkingForTime(parking, now.getHours(), now.getDay());
}

interface GoogleDistanceMatrixResult {
  rows?: Array<{
    elements?: Array<{
      status: string;
      duration?: { value: number }; // seconds, free-flow
      duration_in_traffic?: { value: number }; // seconds, current traffic
    }>;
  }>;
  status: string;
}

/**
 * Fetches real, current-traffic driving time for one destination via
 * Google's Distance Matrix API (departure_time=now, traffic_model=best_guess
 * — this is genuine traffic data, not a heuristic, unlike parking above).
 * Best-effort: any failure (network, quota, or the Distance Matrix API not
 * being enabled on the project) just means the suggestion ships without
 * travel_time_minutes / traffic_delay_minutes rather than failing the
 * request. Called once per Nearby Search result, in parallel — see
 * fetchFromGooglePlaces.
 */
async function fetchTrafficInfo(
  origin: LocationContext,
  destination: { lat: number; lng: number },
  apiKey: string,
): Promise<{ travelTimeMinutes?: number; trafficDelayMinutes?: number }> {
  try {
    const params = new URLSearchParams({
      origins: `${origin.latitude},${origin.longitude}`,
      destinations: `${destination.lat},${destination.lng}`,
      departure_time: 'now',
      traffic_model: 'best_guess',
      mode: 'driving',
      key: apiKey,
    });

    const response = await fetch(`${GOOGLE_DISTANCE_MATRIX_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return {};

    const data = (await response.json()) as GoogleDistanceMatrixResult;
    if (data.status !== 'OK') return {};

    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK' || !element.duration) return {};

    const withTrafficSeconds = element.duration_in_traffic?.value ?? element.duration.value;
    const freeFlowSeconds = element.duration.value;

    return {
      travelTimeMinutes: Math.round(withTrafficSeconds / 60),
      trafficDelayMinutes: Math.max(0, Math.round((withTrafficSeconds - freeFlowSeconds) / 60)),
    };
  } catch {
    return {};
  }
}

export function isPlacesProviderConfigured(): boolean {
  return Boolean(process.env['GOOGLE_PLACES_API_KEY']);
}

/**
 * Extracts today's hours line from a Places API `weekday_text` array
 * (["Monday: 9:00 AM – 5:00 PM", ...], Monday-first) for the given date.
 */
function todaysHoursFrom(weekdayText: string[] | undefined, now: Date): string | undefined {
  if (!weekdayText || weekdayText.length !== 7) return undefined;
  const jsDay = now.getDay(); // 0 = Sunday
  const mondayFirstIndex = jsDay === 0 ? 6 : jsDay - 1;
  const line = weekdayText[mondayFirstIndex];
  if (!line) return undefined;
  const colonIndex = line.indexOf(':');
  return colonIndex === -1 ? line : line.slice(colonIndex + 1).trim();
}

/**
 * Fetches weekly + holiday/special hours for one place. Best-effort: any
 * failure just means the suggestion ships without typical_hours /
 * special_hours_today rather than failing the whole request. Called once
 * per Nearby Search result, in parallel — see fetchFromGooglePlaces.
 */
async function fetchPlaceHours(
  placeId: string,
  apiKey: string,
  now: Date,
): Promise<{ typicalHours?: string; specialHoursToday?: boolean }> {
  try {
    const params = new URLSearchParams({
      place_id: placeId,
      fields: 'opening_hours,current_opening_hours',
      key: apiKey,
    });

    const response = await fetch(`${GOOGLE_PLACES_DETAILS_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return {};

    const data = (await response.json()) as GooglePlaceDetailsResult;
    if (data.status !== 'OK') return {};

    const regularToday = todaysHoursFrom(data.result?.opening_hours?.weekday_text, now);
    const currentToday = todaysHoursFrom(data.result?.current_opening_hours?.weekday_text, now);

    return {
      typicalHours: currentToday ?? regularToday,
      // current_opening_hours reflects any holiday/special-hours override the
      // business has set; if it differs from the regular schedule, today's
      // hours aren't the usual ones.
      specialHoursToday: Boolean(regularToday && currentToday && regularToday !== currentToday),
    };
  } catch {
    return {};
  }
}

async function fetchFromGooglePlaces(
  location: LocationContext,
  category: ActivityCategory,
  now: Date,
): Promise<ActivitySuggestion[]> {
  const apiKey = process.env['GOOGLE_PLACES_API_KEY'];
  if (!apiKey) return [];

  const params = new URLSearchParams({
    location: `${location.latitude},${location.longitude}`,
    radius: '12000', // meters — widened for a broader spread of suggestions
    keyword: CATEGORY_KEYWORDS[category],
    key: apiKey,
  });

  const response = await fetch(`${GOOGLE_PLACES_NEARBY_URL}?${params.toString()}`, {
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`Google Places request failed: ${response.status}`);
  }

  const data = (await response.json()) as GooglePlacesNearbyResult;

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`Google Places returned status ${data.status}`);
  }

  // Halal filtering happens here, before anything downstream ever sees these
  // results — excluded venues never get a Details call, never get scored,
  // never render. Not a toggle; applied to every request.
  const halalFriendly = (data.results ?? []).filter(
    (place) => !isHalalExcluded(place.name, place.types),
  );

  const topResults = halalFriendly.slice(0, 8);

  // Hours and traffic enrichment both happen in parallel across all
  // candidates in this category — and alongside each other, not
  // sequentially — one Details call and one Distance Matrix call per
  // candidate, all fired at once, so latency stays ~1 round trip
  // regardless of how many results came back.
  const [hoursByPlace, trafficByPlace] = await Promise.all([
    Promise.all(topResults.map((place) => fetchPlaceHours(place.place_id, apiKey, now))),
    Promise.all(
      topResults.map((place) => fetchTrafficInfo(location, place.geometry.location, apiKey)),
    ),
  ]);

  return topResults.map((place, i) => ({
    id: place.place_id,
    name: place.name,
    category,
    description: place.vicinity ?? 'Nearby location',
    distance_km: haversineKm(location, place.geometry.location),
    is_open_now: place.opening_hours?.open_now,
    typical_hours: hoursByPlace[i]?.typicalHours,
    special_hours_today: hoursByPlace[i]?.specialHoursToday,
    vibe: estimateVibe(category, now, place.user_ratings_total, place.price_level),
    rating: place.rating,
    review_count: place.user_ratings_total,
    travel_time_minutes: trafficByPlace[i]?.travelTimeMinutes,
    traffic_delay_minutes: trafficByPlace[i]?.trafficDelayMinutes,
    parking_difficulty: estimateParkingDifficulty(category, now, place.user_ratings_total, place.price_level),
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
 *
 * Categories are fetched concurrently (Promise.all), not one at a time —
 * with N categories this is ~1 round trip's worth of latency instead of N.
 *
 * `vibe`, if given, is a *hard* filter: only quiet/moderate/lively matches
 * are returned. If that filter would eliminate every candidate in a
 * category, moderate-vibe results are included as a fallback so the list
 * isn't empty — better one imperfect suggestion than none.
 */
export async function getNearbyActivities(
  location: LocationContext,
  categories: ActivityCategory[],
  now: Date = new Date(),
  vibe?: Vibe,
): Promise<ActivitySuggestion[]> {
  const usePlaces = isPlacesProviderConfigured();

  const perCategory = await Promise.all(
    categories.map(async (category) => {
      if (!usePlaces) return getSampleActivities(location, [category], now);
      try {
        const live = await fetchFromGooglePlaces(location, category, now);
        if (live.length > 0) return live;
        return getSampleActivities(location, [category], now);
      } catch (err) {
        console.warn(`[activityProvider] Google Places lookup failed for ${category}, using sample data:`, err);
        return getSampleActivities(location, [category], now);
      }
    }),
  );

  const results = perCategory.flat();
  if (!vibe) return results;

  const filtered = results.filter((r) => r.vibe === vibe);
  if (filtered.length > 0) return filtered;
  return results.filter((r) => r.vibe === 'moderate' || r.vibe === undefined);
}
