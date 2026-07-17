import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

// ─── Rate Limiting ──────────────────────────────────────────────────────────
//
// Registers @fastify/rate-limit with a global per-IP default. Every route
// gets this ceiling automatically; routes that call an external paid API
// (checkin.ts's classifyEmotion -> Claude, and its Google Places calls) set
// a stricter per-route limit via their route config — see checkin.ts.
//
// Keyed by request.ip. `trustProxy: IS_PRODUCTION` is already set on the
// Fastify instance (see index.ts), so behind CloudFront/EB's load balancer
// this correctly resolves the real client IP from X-Forwarded-For rather
// than rate-limiting the proxy itself.
//
// ─────────────────────────────────────────────────────────────────────────────

async function rateLimitPlugin(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    max: 60,
    timeWindow: '1 minute',
    // Health checks (EB's ELB-HealthChecker hits GET / every ~10-15s) and the
    // plain health route should never be rate-limited or affect the counter.
    allowList: (request) => request.url === '/' || request.url === '/health',
    errorResponseBuilder: (_request, context) => ({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Please try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
      statusCode: 429,
    }),
  });
}

export default fp(rateLimitPlugin, {
  name: 'rate-limit',
  fastify: '4.x',
});
