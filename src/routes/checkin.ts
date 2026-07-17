import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { safeScrubPII } from '../utils/piiScrubber.js';
import { classifyEmotion } from '../services/nlp.service.js';
import { runRecommendationProviders } from '../services/recommendationProviders.js';
import type { CheckinRequest, CheckinResponse } from '../types/index.js';
import { getAllEmotions } from '../utils/emotionTaxonomy.js';

// ─── Zod Validation Schema ────────────────────────────────────────────────────

const emotionValues = getAllEmotions() as [string, ...string[]];

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string().optional(),
});

const checkinBodySchema = z.object({
  input_type: z.enum(['text', 'voice_transcript', 'mood_select']),
  text: z
    .string()
    .max(2000, 'Text input must not exceed 2000 characters')
    .optional(),
  mood_selected: z.enum(emotionValues as [string, ...string[]]).optional(),
  language: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'language must be a BCP-47 tag (e.g. "en", "ar", "ur")')
    .optional(),
  // Optional — only sent if the client has location permission. Powers
  // real-world activity_suggestions alongside verse recommendations; the
  // app works fully without it, same as everything else optional here.
  location: locationSchema.optional(),
  // Hard filter on activity_suggestions (see activityProvider.service.ts's
  // estimateVibe) — only meaningful alongside `location`.
  vibe: z.enum(['quiet', 'moderate', 'lively']).optional(),
});

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function checkinRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/checkin
   *
   * Accepts user's emotional input (text, voice transcript, or mood selection),
   * classifies the emotion via NLP, and returns personalised verse recommendations.
   *
   * Request body:  CheckinRequest
   * Response body: CheckinResponse
   */
  app.post(
    '/api/checkin',
    {
      schema: {
        body: {
          type: 'object',
          required: ['input_type'],
          properties: {
            input_type: { type: 'string', enum: ['text', 'voice_transcript', 'mood_select'] },
            text: { type: 'string', maxLength: 2000 },
            mood_selected: { type: 'string' },
            language: { type: 'string' },
            location: {
              type: 'object',
              properties: {
                latitude: { type: 'number' },
                longitude: { type: 'number' },
                timezone: { type: 'string' },
              },
            },
            vibe: { type: 'string', enum: ['quiet', 'moderate', 'lively'] },
          },
        },
      },
      // Stricter than the app-wide default (see plugins/rateLimit.ts) — this
      // route calls Claude (and, when a location is sent, Google Places /
      // Distance Matrix), all billed per-request. A real user check-in flow
      // rarely needs more than a handful of these a minute; this just keeps a
      // script from running the meter up.
      config: {
        rateLimit: {
          max: 15,
          timeWindow: '1 minute',
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // ── 1. Validate request body ─────────────────────────────────────────
      const parseResult = checkinBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      const body = parseResult.data as CheckinRequest;
      const { input_type, mood_selected, language, location, vibe } = body;
      let { text } = body;

      // ── 2. Validate business logic ───────────────────────────────────────
      if (input_type === 'mood_select' && !mood_selected) {
        return reply.status(400).send({
          error: 'mood_selected is required when input_type is "mood_select"',
        });
      }

      if ((input_type === 'text' || input_type === 'voice_transcript') && !text) {
        return reply.status(400).send({
          error: `text is required when input_type is "${input_type}"`,
        });
      }

      // ── 3. Scrub PII from text before sending to any external service ────
      if (text) {
        text = safeScrubPII(text);
      }

      // ── 4. Classify emotion via NLP service ──────────────────────────────
      let emotionalProfile;
      try {
        emotionalProfile = await classifyEmotion(
          text ?? '',
          language,
          mood_selected as import('../types/index.js').EmotionState | undefined,
        );
      } catch (err) {
        app.log.error({ err }, 'Emotion classification failed');
        return reply.status(503).send({
          error: 'Emotion classification service temporarily unavailable',
          message: 'Please try again in a moment.',
        });
      }

      // ── 5+6. Generate verse recommendations and (if a location was sent)
      //          real-world activity suggestions — concurrently, via the
      //          provider registry (see recommendationProviders.ts). Verses
      //          are always attempted; activities only run when applicable.
      //          One provider failing never blocks or breaks the other. ──
      const contribution = await runRecommendationProviders(
        { profile: emotionalProfile, language, rawText: text, location, vibe },
        undefined,
        (providerName, err) => app.log.warn({ err, provider: providerName }, 'Recommendation provider failed'),
      );
      const recommendations = contribution.recommendations ?? [];
      const { crisis_resources, activity_suggestions } = contribution;

      // ── 7. Persist check-in to Supabase (best-effort, non-blocking) ──────
      const checkinId = randomUUID();
      persistCheckin(app, checkinId, body, emotionalProfile, recommendations).catch(
        (err: unknown) => {
          app.log.warn({ err }, 'Non-critical: Failed to persist check-in');
        },
      );

      // ── 8. Build and return response ────────────────────────────────────
      const response: CheckinResponse = {
        checkin_id: checkinId,
        emotional_profile: emotionalProfile,
        recommendations,
      };

      if (activity_suggestions && activity_suggestions.length > 0) {
        response.activity_suggestions = activity_suggestions;
      }

      if (crisis_resources) {
        response.crisis_resources = crisis_resources;
      }

      // Set response content-type and return
      return reply.status(200).send(response);
    },
  );
}

// ─── Background Persistence ───────────────────────────────────────────────────

async function persistCheckin(
  app: FastifyInstance,
  checkinId: string,
  body: CheckinRequest,
  emotionalProfile: import('../types/index.js').EmotionalProfile,
  recommendations: import('../types/index.js').VerseRecommendation[],
): Promise<void> {
  try {
    // Lazy import to avoid circular dependency at module load time
    const { getSupabaseClient } = await import('../db/client.js');
    const supabase = getSupabaseClient();

    // Persist check-in
    const { error: checkinError } = await (supabase as any)
      .from('check_ins')
      .insert({
        id: checkinId,
        input_type: body.input_type,
        emotional_profile: emotionalProfile,
        language: body.language ?? 'en',
      });

    if (checkinError) {
      app.log.warn({ err: checkinError }, 'Supabase check-in insert failed');
      return;
    }

    // Persist recommendations
    if (recommendations.length > 0) {
      const recRows = recommendations.map((rec, idx) => ({
        checkin_id: checkinId,
        verse_key: rec.verse_key,
        personalized_note: rec.personalized_note,
        relevance_score: rec.relevance_score,
        rank_position: idx + 1,
        was_saved: false,
      }));

      const { error: recError } = await (supabase as any)
        .from('verse_recommendations')
        .insert(recRows);

      if (recError) {
        app.log.warn({ err: recError }, 'Supabase recommendations insert failed');
      }
    }
  } catch (err) {
    app.log.warn({ err }, 'Supabase persistence threw an unexpected error');
  }
}
