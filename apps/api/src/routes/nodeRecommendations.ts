import type { FastifyInstance } from 'fastify';
import { requireUser } from '../lib/auth.js';
import { recommendForUser } from '../services/nodeRanking.js';

export async function nodeRecommendationRoutes(app: FastifyInstance) {
  app.get('/nodes/recommendations', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = await requireUser(req, { gate: false });
    reply.header('cache-control', 'private, max-age=60');
    return recommendForUser(user, req.ip);
  });
}
