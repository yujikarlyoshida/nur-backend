// ─── PII Scrubber ─────────────────────────────────────────────────────────────
//
// Removes personally identifiable information (PII) from free-text input
// before it is sent to any external API (e.g. OpenAI).
//
// Patterns removed:
//   1. Email addresses
//   2. Phone numbers (various international formats)
//   3. Names following common self-introduction phrases
//   4. URLs (http/https/www)
//   5. Numeric identifiers that look like IDs / SSNs
//
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/gi;

// Matches common phone formats: +1 (555) 555-5555, 555-555-5555, 5555555555, etc.
const PHONE_REGEX =
  /(\+?(\d{1,3})?[\s.\-]?)?(\(?\d{2,4}\)?[\s.\-]?)(\d{3,4}[\s.\-]?\d{3,4})([\s.\-]?\d{1,4})?/g;

// Matches "I am John", "My name is Jane Smith", "I'm Ali Hassan"
const SELF_INTRO_REGEX =
  /\b(I am|I'm|my name is|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi;

// Matches http/https/ftp URLs and bare www. domains
const URL_REGEX =
  /(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"{}|\\^`[\]]+/gi;

// Matches social-security-number-like patterns (XXX-XX-XXXX or XXXXXXXXX)
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b/g;

// ─── Replacement Tokens ───────────────────────────────────────────────────────

const REPLACED_EMAIL = '[EMAIL]';
const REPLACED_PHONE = '[PHONE]';
const REPLACED_NAME = '$1 [NAME]';
const REPLACED_URL = '[URL]';
const REPLACED_SSN = '[ID]';

// ─── Core Scrub Function ─────────────────────────────────────────────────────

/**
 * Strips PII from the given text and returns a sanitized version.
 * The order of replacements matters — emails are stripped before
 * generic phone-number detection to avoid partial matches on email
 * local parts that contain digits.
 */
export function scrubPII(text: string): string {
  if (!text || text.trim().length === 0) {
    return text;
  }

  let sanitized = text;

  // 1. Remove email addresses first (before phone, to avoid digit overlap)
  sanitized = sanitized.replace(EMAIL_REGEX, REPLACED_EMAIL);

  // 2. Remove self-introduction names
  sanitized = sanitized.replace(SELF_INTRO_REGEX, REPLACED_NAME);

  // 3. Remove URLs
  sanitized = sanitized.replace(URL_REGEX, REPLACED_URL);

  // 4. Remove SSN-like identifiers
  sanitized = sanitized.replace(SSN_REGEX, REPLACED_ID_token);

  // 5. Remove phone numbers — applied last to avoid matching short numeric
  //    sequences that might be verse numbers or other meaningful data.
  //    Only strip if the matched segment is ≥ 7 digits long.
  sanitized = sanitized.replace(PHONE_REGEX, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length >= 7) {
      return REPLACED_PHONE;
    }
    return match;
  });

  // Collapse multiple whitespace created by replacements
  sanitized = sanitized.replace(/\s{2,}/g, ' ').trim();

  return sanitized;
}

// Alias used in scrubPII to keep lint happy with the module-level constant
const REPLACED_ID_token: string = REPLACED_SSN;

// ─── Utility: Check whether text still contains potential PII ────────────────

/**
 * Returns true if the text likely contains un-scrubbed PII.
 * Useful for logging / alerting.
 */
export function containsPII(text: string): boolean {
  return (
    EMAIL_REGEX.test(text) ||
    SELF_INTRO_REGEX.test(text) ||
    URL_REGEX.test(text) ||
    SSN_REGEX.test(text)
  );
}

// Reset lastIndex on RegExp instances (they are stateful with the `g` flag)
function resetRegexes(): void {
  EMAIL_REGEX.lastIndex = 0;
  SELF_INTRO_REGEX.lastIndex = 0;
  URL_REGEX.lastIndex = 0;
  SSN_REGEX.lastIndex = 0;
  PHONE_REGEX.lastIndex = 0;
}

// Re-export a version that guarantees regex state is fresh before each call
export function safeScrubPII(text: string): string {
  resetRegexes();
  return scrubPII(text);
}
