import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// ─── Health Route ─────────────────────────────────────────────────────────────

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' },
              uptime: { type: 'number' },
              version: { type: 'string' },
              environment: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.status(200).send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env['npm_package_version'] ?? '1.0.0',
        environment: process.env['NODE_ENV'] ?? 'development',
      });
    },
  );

  // Liveness probe (Kubernetes-style)
  app.get(
    '/health/live',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.status(200).send({ status: 'alive' });
    },
  );

  // Readiness probe — checks that critical env vars are present
  app.get(
    '/health/ready',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const checks: Record<string, boolean> = {
        openai_configured: Boolean(process.env['OPENAI_API_KEY']),
        supabase_configured:
          Boolean(process.env['SUPABASE_URL']) &&
          Boolean(process.env['SUPABASE_ANON_KEY']),
        quran_api_configured: Boolean(process.env['QURAN_API_BASE']),
      };

      const allReady = Object.values(checks).every(Boolean);

      return reply.status(allReady ? 200 : 503).send({
        status: allReady ? 'ready' : 'not_ready',
        checks,
        timestamp: new Date().toISOString(),
      });
    },
  );
}
