import 'dotenv/config';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';

// ─── Plugins ──────────────────────────────────────────────────────────────────
import corsPlugin from './plugins/cors.js';
import sensiblePlugin from './plugins/sensible.js';
import rateLimitPlugin from './plugins/rateLimit.js';

// ─── Routes ───────────────────────────────────────────────────────────────────
import { healthRoutes } from './routes/health.js';
import { checkinRoutes } from './routes/checkin.js';
import { versesRoutes } from './routes/verses.js';
import { recommendationsRoutes } from './routes/recommendations.js';

// ─── Configuration ────────────────────────────────────────────────────────────

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const IS_PRODUCTION = process.env['NODE_ENV'] === 'production';

// ─── Build Application ────────────────────────────────────────────────────────

export async function buildApp() {
  const app = Fastify({
    logger: IS_PRODUCTION
      ? {
          level: 'info',
          serializers: {
            req(req) {
              return {
                method: req.method,
                url: req.url,
                hostname: req.hostname,
              };
            },
          },
        }
      : {
          level: 'debug',
          transport: {
            target: 'pino-pretty',
            options: {
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
              colorize: true,
            },
          },
        },
    trustProxy: IS_PRODUCTION,
    requestIdLogLabel: 'request_id',
    genReqId: () => crypto.randomUUID(),
  });

  // ── Security headers ───────────────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: false, // CSP managed by the frontend
    crossOriginEmbedderPolicy: false,
  });

  // ── CORS ──────────────────────────────────────────────────────────────────
  await app.register(corsPlugin);

  // ── Rate limiting ─────────────────────────────────────────────────────────
  // Registered early so it can reject abusive requests before they reach any
  // route handler — in particular before checkin.ts's Claude API call, which
  // costs real money per request. See plugins/rateLimit.ts.
  await app.register(rateLimitPlugin);

  // ── Sensible error helpers ────────────────────────────────────────────────
  await app.register(sensiblePlugin);

  // ── Global error handler ──────────────────────────────────────────────────
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode ?? 500;

    app.log.error({
      err: error,
      request_id: request.id,
      url: request.url,
      method: request.method,
    });

    // Don't leak internal error details in production
    const message = IS_PRODUCTION && statusCode === 500
      ? 'An internal error occurred. Please try again.'
      : error.message;

    return reply.status(statusCode).send({
      error: error.name ?? 'Error',
      message,
      statusCode,
      ...(IS_PRODUCTION ? {} : { stack: error.stack }),
    });
  });

  // ── 404 handler ───────────────────────────────────────────────────────────
  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: 'Not Found',
      message: `Route ${request.method} ${request.url} not found`,
      statusCode: 404,
    });
  });

  // ── Root ──────────────────────────────────────────────────────────────────
  // Elastic Beanstalk's health checker (and most uptime monitors) hit `GET /`
  // by default. Without this, that request 404s — the app itself is fine,
  // but EB's health check reads repeated 404s as "unhealthy" and marks the
  // environment Red even though every real route works. A trivial 200 here
  // fixes that without needing to reconfigure EB's health check path.
  app.get('/', async () => ({
    name: 'nur-backend',
    status: 'ok',
    docs: '/health',
  }));

  // ── Routes ────────────────────────────────────────────────────────────────
  await app.register(healthRoutes);
  await app.register(checkinRoutes);
  await app.register(versesRoutes);
  await app.register(recommendationsRoutes);

  // ── Request logging hook ──────────────────────────────────────────────────
  app.addHook('onRequest', async (request) => {
    request.log.info({
      method: request.method,
      url: request.url,
      userAgent: request.headers['user-agent'],
    }, 'incoming request');
  });

  app.addHook('onResponse', async (request, reply) => {
    request.log.info({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: reply.elapsedTime,
    }, 'request completed');
  });

  return app;
}

// ─── Startup ──────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  const app = await buildApp();

  try {
    const address = await app.listen({ port: PORT, host: HOST });
    app.log.info(`Quran Wellbeing API listening at ${address}`);
    app.log.info(`Environment: ${process.env['NODE_ENV'] ?? 'development'}`);
    app.log.info(`OpenAI configured: ${Boolean(process.env['OPENAI_API_KEY'])}`);
    app.log.info(`Supabase configured: ${Boolean(process.env['SUPABASE_URL'])}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // ── Graceful shutdown ─────────────────────────────────────────────────────

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}. Shutting down gracefully...`);
    try {
      await app.close();
      app.log.info('Server closed successfully.');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    app.log.error({ err }, 'Uncaught exception — shutting down');
    void shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    app.log.error({ reason }, 'Unhandled promise rejection — shutting down');
    void shutdown('unhandledRejection');
  });
}

// Start server — guard allows this file to be imported in tests without auto-starting.
// tsx sets process.argv[1] to the .ts source path; compiled JS sets it to the .js path.
const _entryFile = process.argv[1] ?? '';
if (
  _entryFile.endsWith('index.ts') ||
  _entryFile.endsWith('index.js')
) {
  void start();
}
