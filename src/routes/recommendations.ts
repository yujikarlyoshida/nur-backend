import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getAllEmotions } from '../utils/emotionTaxonomy.js';
import { getRecommendations } from '../services/recommendation.service.js';
import { EMOTION_TAXONOMY } from '../utils/emotionTaxonomy.js';
import type { EmotionState } from '../types/index.js';

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const checkinIdParamSchema = z.object({
  checkinId: z.string().uuid('checkinId must be a valid UUID'),
});

const emotionValues = getAllEmotions() as [EmotionState, ...EmotionState[]];

const directRecommendationSchema = z.object({
  emotion: z.enum(emotionValues),
  intensity: z.coerce.number().int().min(1).max(10).optional().default(5),
  language: z.string().optional(),
  spiritual_need: z
    .enum(['comfort', 'guidance', 'meaning', 'forgiveness', 'gratitude'])
    .optional(),
  life_domain: z
    .enum(['general', 'relationships', 'work', 'health', 'faith', 'family'])
    .optional(),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function recommendationsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/recommendations/:checkinId
   *
   * Returns recommendations for a previously stored check-in.
   * Looks up the emotional profile from Supabase and regenerates
   * recommendations if they are not cached.
   */
  app.get(
    '/api/recommendations/:checkinId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramResult = checkinIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          error: 'Invalid checkin ID',
          details: paramResult.error.flatten(),
        });
      }

      const { checkinId } = paramResult.data;

      try {
        // Lazy import Supabase to allow the server to start without DB config
        const { getSupabaseClient } = await import('../db/client.js');
        const supabase = getSupabaseClient();

        // 1. Fetch the check-in record
        const { data: checkin, error: checkinError } = await (supabase as any)
          .from('check_ins')
          .select('*')
          .eq('id', checkinId)
          .single();

        if (checkinError || !checkin) {
          return reply.status(404).send({
            error: 'Check-in not found',
            checkin_id: checkinId,
          });
        }

        // 2. Fetch stored recommendations for this check-in
        const { data: storedRecs, error: recsError } = await (supabase as any)
          .from('verse_recommendations')
          .select('*')
          .eq('checkin_id', checkinId)
          .order('rank_position', { ascending: true });

        if (!recsError && storedRecs && storedRecs.length > 0) {
          // Return stored recommendations — no need to re-generate
          return reply.status(200).send({
            checkin_id: checkinId,
            emotional_profile: checkin.emotional_profile,
            recommendations: storedRecs,
          });
        }

        // 3. Regenerate recommendations if none are stored
        const { recommendations, crisis_resources } = await getRecommendations(
          checkin.emotional_profile,
          checkin.language ?? 'en',
        );

        const response: Record<string, unknown> = {
          checkin_id: checkinId,
          emotional_profile: checkin.emotional_profile,
          recommendations,
        };

        if (crisis_resources) {
          response['crisis_resources'] = crisis_resources;
        }

        return reply.status(200).send(response);
      } catch (err) {
        app.log.error({ err, checkinId }, 'Failed to fetch recommendations');
        return reply.status(500).send({
          error: 'Failed to retrieve recommendations',
        });
      }
    },
  );

  /**
   * GET /api/recommendations/direct?emotion=anxiety&intensity=7&language=en
   *
   * Returns recommendations directly for a given emotion without a prior check-in.
   * Useful for mood-select flows or quick lookups.
   */
  app.get(
    '/api/recommendations/direct',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = directRecommendationSchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          details: parseResult.error.flatten(),
          valid_emotions: getAllEmotions(),
        });
      }

      const {
        emotion,
        intensity,
        language,
        spiritual_need,
        life_domain,
      } = parseResult.data;

      const entry = EMOTION_TAXONOMY[emotion];

      // Build a synthetic emotional profile from query params
      const profile = {
        primary_emotion: emotion,
        intensity: intensity,
        spiritual_need: (spiritual_need ?? entry.spiritual_need) as import('../types/index.js').SpiritualNeed,
        life_domain: (life_domain ?? 'general') as import('../types/index.js').LifeDomain,
        themes: entry.themes.slice(0, 3),
        reasoning: 'Direct emotion lookup via query parameters.',
        crisis: false,
      };

      try {
        const { recommendations, crisis_resources } = await getRecommendations(
          profile,
          language,
        );

        const response: Record<string, unknown> = {
          emotion,
          emotional_profile: profile,
          recommendations,
        };

        if (crisis_resources) {
          response['crisis_resources'] = crisis_resources;
        }

        return reply.status(200).send(response);
      } catch (err) {
        app.log.error({ err, emotion }, 'Direct recommendation failed');
        return reply.status(500).send({
          error: 'Failed to generate recommendations',
        });
      }
    },
  );
}
