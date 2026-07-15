import Anthropic from '@anthropic-ai/sdk';
import type { EmotionalProfile, EmotionState } from '../types/index.js';
import { EMOTION_TAXONOMY } from '../utils/emotionTaxonomy.js';

// ─── Anthropic Client ─────────────────────────────────────────────────────────

function getAnthropicClient(): Anthropic {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY environment variable.');
  }
  return new Anthropic({ apiKey });
}

// ─── Crisis Detection Keywords ────────────────────────────────────────────────

const CRISIS_KEYWORDS = [
  'suicide',
  'suicidal',
  'kill myself',
  'end my life',
  'want to die',
  'no reason to live',
  'can\'t go on',
  'self-harm',
  'self harm',
  'hurt myself',
  'cutting',
  'overdose',
  'don\'t want to be here',
  'better off dead',
  'wish i was dead',
  'انتحار',         // Arabic: suicide
  'اقتل نفسي',     // Arabic: kill myself
  'لا أريد العيش', // Arabic: don't want to live
];

function detectCrisisSignals(text: string): boolean {
  const lowerText = text.toLowerCase();
  return CRISIS_KEYWORDS.some((keyword) => lowerText.includes(keyword.toLowerCase()));
}

// ─── System Prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(language?: string): string {
  const langNote = language && language !== 'en'
    ? `The user's preferred language is "${language}". Analyse the text accordingly, but always respond in valid JSON.`
    : 'Analyse the following text in English.';

  return `You are a compassionate Islamic wellbeing assistant with deep knowledge of Quranic themes, emotions, and spiritual needs.

${langNote}

Your task is to analyse the emotional content of a user's reflection and return a structured emotional profile as VALID JSON ONLY. Do not include any explanatory text, markdown code blocks, or commentary — return ONLY the raw JSON object.

The JSON must match this exact schema:
{
  "primary_emotion": one of ["anxiety","sadness","anger","loneliness","gratitude","hope","guilt","confusion","peace","overwhelmed","grief","disconnection","joy"],
  "intensity": integer from 1 to 10 (1=very mild, 10=extremely intense),
  "spiritual_need": one of ["comfort","guidance","meaning","forgiveness","gratitude"],
  "life_domain": one of ["general","relationships","work","health","faith","family"],
  "themes": array of 2-4 Quranic/Islamic themes as strings (e.g. "tawakkul", "sabr", "dhikr", "tawbah"),
  "reasoning": one sentence (max 30 words) explaining your classification,
  "crisis": boolean (true ONLY if the text contains clear self-harm or suicidal ideation)
}

Rules:
- Be empathetic and spiritually aware
- intensity should reflect the urgency and depth of the emotion expressed
- themes must be authentic Islamic/Quranic concepts
- reasoning must be concise and compassionate, never clinical or judgmental
- crisis must be true ONLY for genuine self-harm/suicidal language, not general sadness`;
}

// ─── Fallback Profile Builder ─────────────────────────────────────────────────

function buildFallbackProfile(
  text: string,
  moodSelected?: EmotionState,
): EmotionalProfile {
  const emotion: EmotionState = moodSelected ?? 'sadness';
  const entry = EMOTION_TAXONOMY[emotion];
  const hasCrisis = detectCrisisSignals(text);

  return {
    primary_emotion: emotion,
    intensity: 5,
    spiritual_need: entry.spiritual_need,
    life_domain: 'general',
    themes: entry.themes.slice(0, 3),
    reasoning: 'Emotion classification used fallback taxonomy (AI service unavailable).',
    crisis: hasCrisis,
  };
}

// ─── JSON Parse Helper ────────────────────────────────────────────────────────

function parseEmotionalProfile(raw: string): EmotionalProfile {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const parsed = JSON.parse(cleaned) as Record<string, unknown>;

  const requiredFields: (keyof EmotionalProfile)[] = [
    'primary_emotion',
    'intensity',
    'spiritual_need',
    'life_domain',
    'themes',
    'reasoning',
  ];

  for (const field of requiredFields) {
    if (parsed[field] === undefined) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  const intensity = Math.min(10, Math.max(1, Number(parsed['intensity'])));

  return {
    primary_emotion: parsed['primary_emotion'] as EmotionState,
    intensity,
    spiritual_need: parsed['spiritual_need'] as EmotionalProfile['spiritual_need'],
    life_domain: parsed['life_domain'] as EmotionalProfile['life_domain'],
    themes: Array.isArray(parsed['themes']) ? (parsed['themes'] as string[]) : [],
    reasoning: String(parsed['reasoning'] ?? ''),
    crisis: Boolean(parsed['crisis'] ?? false),
  };
}

// ─── Main Classification Function ────────────────────────────────────────────

/**
 * Classifies the emotional content of a user's text using Claude.
 *
 * @param text         Sanitised (PII-scrubbed) user input text
 * @param language     Optional BCP-47 language tag (e.g. "ar", "ur", "en")
 * @param moodSelected Optional emotion pre-selected by the user via mood picker
 * @returns            A structured EmotionalProfile
 */
export async function classifyEmotion(
  text: string,
  language?: string,
  moodSelected?: EmotionState,
): Promise<EmotionalProfile> {
  if (!text || text.trim().length < 5) {
    const emotion = moodSelected ?? 'sadness';
    const entry = EMOTION_TAXONOMY[emotion];
    return {
      primary_emotion: emotion,
      intensity: 5,
      spiritual_need: entry.spiritual_need,
      life_domain: 'general',
      themes: entry.themes.slice(0, 3),
      reasoning: 'Short or empty input; using selected mood.',
      crisis: false,
    };
  }

  const hasCrisisLocally = detectCrisisSignals(text);

  let anthropic: Anthropic;
  try {
    anthropic = getAnthropicClient();
  } catch {
    const fallback = buildFallbackProfile(text, moodSelected);
    fallback.crisis = fallback.crisis || hasCrisisLocally;
    return fallback;
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 400,
      system: buildSystemPrompt(language),
      messages: [{ role: 'user', content: text }],
    });

    const rawContent = message.content[0]?.type === 'text' ? message.content[0].text : null;
    if (!rawContent) {
      throw new Error('Empty response from Claude');
    }

    const profile = parseEmotionalProfile(rawContent);

    if (hasCrisisLocally) {
      profile.crisis = true;
    }

    return profile;
  } catch (err) {
    console.error('[nlp.service] Claude classification failed:', err);
    const fallback = buildFallbackProfile(text, moodSelected);
    fallback.crisis = fallback.crisis || hasCrisisLocally;
    return fallback;
  }
}

/**
 * Generate a personalised note for a specific verse given an emotional profile.
 * Used by recommendation.service.ts when generating per-verse context.
 */
export async function generatePersonalizedNote(
  verseKey: string,
  verseTranslation: string,
  profile: EmotionalProfile,
  language?: string,
): Promise<string> {
  let anthropic: Anthropic;
  try {
    anthropic = getAnthropicClient();
  } catch {
    return buildFallbackNote(verseKey, profile);
  }

  const langInstruction = language && language !== 'en'
    ? `Respond in ${language}.`
    : 'Respond in English.';

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      system: `You are a compassionate Islamic spiritual guide. ${langInstruction}
Write a warm, personalised 1-2 sentence note connecting the given Quran verse to the user's current emotional state.
Be specific, empathetic, and spiritually grounding. Do not be generic.
Mention the key spiritual concept from the verse and how it directly addresses the emotion.
Write as if speaking directly to the person.`,
      messages: [
        {
          role: 'user',
          content: `Verse ${verseKey}: "${verseTranslation}"
User's primary emotion: ${profile.primary_emotion} (intensity: ${profile.intensity}/10)
Spiritual need: ${profile.spiritual_need}
Themes they resonate with: ${profile.themes.join(', ')}

Write a personalised note for this verse.`,
        },
      ],
    });

    const text = message.content[0]?.type === 'text' ? message.content[0].text.trim() : null;
    return text ?? buildFallbackNote(verseKey, profile);
  } catch {
    return buildFallbackNote(verseKey, profile);
  }
}

function buildFallbackNote(verseKey: string, profile: EmotionalProfile): string {
  const entry = EMOTION_TAXONOMY[profile.primary_emotion];
  return `This verse (${verseKey}) speaks directly to the feeling of ${profile.primary_emotion}. `
    + `Through the lens of ${entry.arabic_concept}, it offers the spiritual grounding your heart seeks. `
    + `May it bring you the ${profile.spiritual_need} you need in this moment.`;
}
