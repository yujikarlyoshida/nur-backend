import { describe, it, expect } from 'vitest';
import { isHalalExcluded } from '../src/services/activityProvider.service.js';

// isHalalExcluded is the hard, unconditional filter applied to every live
// Google Places result before it's ever scored or returned (see the halal
// filtering note at the top of activityProvider.service.ts). These tests
// cover both filtering layers: Google's `types` taxonomy and the
// name-keyword blocklist that catches what `types` misses.

describe('isHalalExcluded', () => {
  it('excludes venues typed as bar, night_club, liquor_store, or casino', () => {
    expect(isHalalExcluded('The Copper Still', ['bar', 'restaurant'])).toBe(true);
    expect(isHalalExcluded('Voltage', ['night_club', 'point_of_interest'])).toBe(true);
    expect(isHalalExcluded('Total Wine & More', ['liquor_store'])).toBe(true);
    expect(isHalalExcluded('Lucky Star Casino', ['casino'])).toBe(true);
  });

  it('excludes venues by name even when types are missing or generic', () => {
    expect(isHalalExcluded("Murphy's Irish Pub", ['restaurant'])).toBe(true);
    expect(isHalalExcluded('Skyline Nightclub', undefined)).toBe(true);
    expect(isHalalExcluded('The Velvet Lounge', ['restaurant'])).toBe(true);
    expect(isHalalExcluded('Riverside Brewery', ['restaurant'])).toBe(true);
    expect(isHalalExcluded("Domaine Chandon Winery", [])).toBe(true);
    expect(isHalalExcluded('Sunset Wine Bar', ['restaurant'])).toBe(true);
    expect(isHalalExcluded('Copper & Oak Distillery', [])).toBe(true);
  });

  it('excludes pork- and gelatin-centric food venues by name', () => {
    expect(isHalalExcluded('Smokehouse Pulled Pork BBQ', ['restaurant'])).toBe(true);
    expect(isHalalExcluded('Bacon & Eggs Diner', ['restaurant'])).toBe(true);
    expect(isHalalExcluded('Ham & Cheese Deli', ['restaurant'])).toBe(true);
    expect(isHalalExcluded('Artisan Charcuterie Board Co', ['restaurant'])).toBe(true);
    expect(isHalalExcluded('Gelatin Dessert House', ['restaurant', 'food'])).toBe(true);
  });

  it('does not exclude ordinary halal-friendly venues', () => {
    expect(isHalalExcluded('Al-Salam Halal Restaurant', ['restaurant', 'food'])).toBe(false);
    expect(isHalalExcluded('Riverside Park', ['park'])).toBe(false);
    expect(isHalalExcluded('Downtown Public Library', ['library'])).toBe(false);
    expect(isHalalExcluded('Community Mosque', ['mosque', 'place_of_worship'])).toBe(false);
    expect(isHalalExcluded('K1 Speed Indoor Karting', ['amusement_center'])).toBe(false);
  });

  it('does not false-positive on substrings inside unrelated words', () => {
    // "bar" and "pub" as whole words are excluded, but should not match
    // inside unrelated words like "barbershop" or "Publix".
    expect(isHalalExcluded('Fresh Cuts Barbershop', ['hair_care'])).toBe(false);
    expect(isHalalExcluded('Publix Supermarket', ['supermarket'])).toBe(false);
  });
});
