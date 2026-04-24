// fastify-plugin is a peer dependency of @fastify/cors — available transitively.
// If it is not found, install it: npm i fastify-plugin
import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

// ─── CORS Plugin ─────────────────────────────────────────────────────────────
//
// Registers @fastify/cors with environment-aware allowed origins.
// In development, all origins are permitted.
// In production, only explicitly listed origins are allowed.
//
// ─────────────────────────────────────────────────────────────────────────────

async function corsPlugin(app: FastifyInstance): Promise<void> {
  const isDevelopment = process.env['NODE_ENV'] !== 'production';

  const allowedOrigins = (process.env['ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, Postman)
      if (!origin) {
        callback(null, true);
        return;
      }

      // In development, allow everything
      if (isDevelopment) {
        callback(null, true);
        return;
      }

      // In production, check the allow-list
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
    },

    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Accept-Language',
    ],
    exposedHeaders: ['X-Request-Id'],
    credentials: true,
    maxAge: 86400, // 24 hours preflight cache
  });
}

export default fp(corsPlugin, {
  name: 'cors',
  fastify: '4.x',
});
