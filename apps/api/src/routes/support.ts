import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../lib/auth.js';
import { readSupportPhoto, supportPhotosSchema, SUPPORT_PHOTO_BODY_LIMIT } from '../services/supportAttachments.js';
import { createTicket, getThread, openChat, postUserMessage, rateMessage, supportOverview, userClose, userEscalate } from '../services/support.js';

const id = z.object({ id: z.string().uuid() });
const prio = z.enum(['normal', 'important', 'urgent']);

/** Поддержка для пользователя. Работает и при включённом «жёстком» гейте канала — помощь нужна всем. */
export async function supportRoutes(app: FastifyInstance) {
  const u = (req: any) => requireUser(req, { gate: false });
  app.get('/support', async (req) => supportOverview(await u(req)));
  app.post('/support/chat', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => openChat(await u(req)));
  app.post('/support/tickets', { bodyLimit: SUPPORT_PHOTO_BODY_LIMIT, config: { rateLimit: { max: 6, timeWindow: '10 minutes' } } }, async (req) => {
    const b = z.object({ subject: z.string().max(120).default(''), body: z.string().max(2000).default(''), priority: prio.default('normal'), photos: supportPhotosSchema }).parse(req.body);
    return createTicket(await u(req), b);
  });
  app.get('/support/attachments/:id', async (req, reply) => {
    const user = await u(req);
    const photo = await readSupportPhoto(id.parse(req.params).id, user.id);
    return reply.header('content-type', photo.mime).header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff').header('content-disposition', 'inline; filename="support-photo.jpg"').send(photo.data);
  });
  app.get('/support/tickets/:id', async (req) => getThread(await u(req), id.parse(req.params).id));
  app.post('/support/tickets/:id/messages', { bodyLimit: SUPPORT_PHOTO_BODY_LIMIT, config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ text: z.string().max(2000).default(''), photos: supportPhotosSchema }).parse(req.body);
    return postUserMessage(await u(req), id.parse(req.params).id, b.text, b.photos);
  });
  app.post('/support/tickets/:id/escalate', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ priority: prio.default('normal') }).parse(req.body ?? {});
    return userEscalate(await u(req), id.parse(req.params).id, b.priority);
  });
  app.post('/support/tickets/:id/close', async (req) => userClose(await u(req), id.parse(req.params).id));
  app.post('/support/messages/:id/rate', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ rating: z.union([z.literal(1), z.literal(-1)]) }).parse(req.body);
    return rateMessage(await u(req), id.parse(req.params).id, b.rating);
  });
}
