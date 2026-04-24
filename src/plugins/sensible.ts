import fp from 'fastify-plugin';
import sensible from '@fastify/sensible';
import type { FastifyInstance } from 'fastify';

// ─── Sensible Plugin ──────────────────────────────────────────────────────────
//
// Registers @fastify/sensible which adds:
//   - app.httpErrors.* helpers (badRequest, unauthorized, notFound, etc.)
//   - app.assert() for quick assertions
//   - Standardised error responses
//
// ─────────────────────────────────────────────────────────────────────────────

async function sensiblePlugin(app: FastifyInstance): Promise<void> {
  await app.register(sensible);
}

export default fp(sensiblePlugin, {
  name: 'sensible',
  fastify: '4.x',
});
