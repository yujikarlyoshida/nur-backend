import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  getVerseByKey,
  searchVerses,
  getVersesByEmotion,
} from '../services/verse.service.js';
import type { EmotionState } from '../types/index.js';
import { getAllEmotions } from '../utils/emotionTaxonomy.js';

// ─── Schema Validation ────────────────────────────────────────────────────────

const verseKeyParamSchema = z.object({
  verseKey: z
    .string()
    .regex(/^\d{1,3}:\d{1,3}$/, 'verseKey must be in format "surah:ayah" e.g. "2:286"'),
});

const searchQuerySchema = z.object({
  q: z.string().min(2, 'Query must be at least 2 characters').max(200),
  lang: z.string().optional(),
});

const emotionParamSchema = z.object({
  emotion: z.enum(getAllEmotions() as [EmotionState, ...EmotionState[]]),
});

const langQuerySchema = z.object({
  lang: z.string().optional(),
});

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function versesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/verses/search?q=...&lang=...
   *
   * Must be registered BEFORE /:verseKey to avoid "search" being matched
   * as a verse key parameter.
   */
  app.get(
    '/api/verses/search',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = searchQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          details: parseResult.error.flatten(),
        });
      }

      const { q, lang } = parseResult.data;

      try {
        const verses = await searchVerses(q, lang);
        return reply.status(200).send({
          query: q,
          count: verses.length,
          verses,
        });
      } catch (err) {
        app.log.error({ err }, 'Failed to search verses');
        return reply.status(502).send({
          error: 'Verse search service unavailable',
          message: 'Could not reach the Quran API. Please try again.',
        });
      }
    },
  );

  /**
   * GET /api/verses/by-emotion/:emotion?lang=...
   *
   * Returns curated verses for a given emotional state.
   * Must be registered before /:verseKey.
   */
  app.get(
    '/api/verses/by-emotion/:emotion',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramResult = emotionParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          error: 'Invalid emotion',
          details: paramResult.error.flatten(),
          valid_emotions: getAllEmotions(),
        });
      }

      const queryResult = langQuerySchema.safeParse(request.query);
      const lang = queryResult.success ? queryResult.data.lang : undefined;

      const { emotion } = paramResult.data;

      try {
        const verses = await getVersesByEmotion(emotion, lang);
        return reply.status(200).send({
          emotion,
          count: verses.length,
          verses,
        });
      } catch (err) {
        app.log.error({ err, emotion }, 'Failed to fetch verses by emotion');
        return reply.status(500).send({
          error: 'Could not retrieve verses',
        });
      }
    },
  );

  /**
   * GET /api/verses/:verseKey?lang=...
   *
   * Fetches a single verse by its key (e.g. "2:286").
   */
  app.get(
    '/api/verses/:verseKey',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramResult = verseKeyParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          error: 'Invalid verse key format',
          details: paramResult.error.flatten(),
          example: 'Use format "2:286" for Surah 2, Ayah 286',
        });
      }

      const queryResult = langQuerySchema.safeParse(request.query);
      const lang = queryResult.success ? queryResult.data.lang : undefined;

      const { verseKey } = paramResult.data;

      try {
        const verse = await getVerseByKey(verseKey, lang);
        return reply.status(200).send({ verse });
      } catch (err) {
        app.log.error({ err, verseKey }, 'Failed to fetch verse');
        return reply.status(404).send({
          error: 'Verse not found',
          verse_key: verseKey,
        });
      }
    },
  );
}
