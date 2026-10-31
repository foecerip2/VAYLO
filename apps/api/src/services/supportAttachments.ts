import sharp from 'sharp';
import { z } from 'zod';
import { sql, type TxSql } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import type { SupportAttachmentDTO } from '@vpn/shared';

export const MAX_SUPPORT_PHOTOS = 3;
export const MAX_SUPPORT_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_ENCODED = Math.ceil(MAX_SUPPORT_PHOTO_BYTES / 3) * 4 + 64;
export const SUPPORT_PHOTO_BODY_LIMIT = MAX_SUPPORT_PHOTOS * MAX_ENCODED + 16_384;
export const supportPhotosSchema = z.array(z.object({
  image: z.string().min(1).max(MAX_ENCODED),
  name: z.string().max(180).optional(),
})).max(MAX_SUPPORT_PHOTOS, 'Можно приложить до трёх фото').default([]);
export type SupportPhotoInput = z.infer<typeof supportPhotosSchema>[number];
export interface PreparedSupportPhoto { data: Buffer; name: string; mime: 'image/jpeg'; width: number; height: number }

// Bounded native work on small VPS; no full-resolution originals or EXIF are retained.
sharp.concurrency(1);
sharp.cache({ memory: 16, files: 0, items: 16 });
export async function prepareSupportPhotos(input: SupportPhotoInput[]): Promise<PreparedSupportPhoto[]> {
  const inputs = supportPhotosSchema.parse(input);
  const result: PreparedSupportPhoto[] = [];
  for (const [index, photo] of inputs.entries()) {
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo.image);
    if (!match) throw badRequest('Выберите фото JPG, PNG или WebP', 'support_photo_format');
    const data = Buffer.from(match[2]!, 'base64');
    if (!data.length || data.length > MAX_SUPPORT_PHOTO_BYTES || data.toString('base64') !== match[2]) throw badRequest('Фото должно быть до 2 МБ после подготовки', 'support_photo_size');
    try {
      const image = sharp(data, { limitInputPixels: 24_000_000, failOn: 'warning' });
      const meta = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '') || meta.format !== match[1] || (meta.pages ?? 1) > 1) throw new Error('format');
      const pipeline = image.rotate().resize({ width: 2048, height: 4096, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' });
      let output = await pipeline.clone().jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
      for (const quality of [78, 68, 58]) {
        if (output.data.length <= MAX_SUPPORT_PHOTO_BYTES) break;
        output = await pipeline.clone().jpeg({ quality }).toBuffer({ resolveWithObject: true });
      }
      if (output.data.length > MAX_SUPPORT_PHOTO_BYTES) throw new Error('output_size');
      const stem = (photo.name ?? `Фото ${index + 1}`).normalize('NFKC').replace(/\.[^.]+$/, '')
        .replace(/[^\p{L}\p{N} ._()-]/gu, '_').trim().slice(0, 90) || `Фото ${index + 1}`;
      result.push({ data: output.data, name: stem + '.jpg', mime: 'image/jpeg', width: output.info.width, height: output.info.height });
    } catch {
      throw badRequest('Не удалось прочитать фото. Сохраните его как JPG или PNG и попробуйте снова.', 'support_photo_invalid');
    }
  }
  return result;
}

export async function storeSupportPhotos(tx: TxSql, messageId: string, ticketId: string, photos: PreparedSupportPhoto[]) {
  if (!photos.length) return;
  // The same transaction inserts the message and its photos. This lock also makes
  // storage budgets correct when several uploads arrive at the same time.
  await tx`select pg_advisory_xact_lock(81472)`;
  const [budget] = await tx`
    select count(*) filter(where m.ticket_id=${ticketId})::int as ticket_count,
      coalesce(sum(a.size),0)::bigint as total_bytes
    from support_attachments a join support_messages m on m.id=a.message_id`;
  if (budget.ticket_count + photos.length > 30) throw conflict('В обращении уже 30 фото. Для новых снимков создайте отдельное обращение.', 'support_photo_ticket_limit');
  const bytes = photos.reduce((sum, p) => sum + p.data.length, 0);
  const [message] = await tx`select author from support_messages where id=${messageId}`;
  if (message.author === 'user') {
    const [daily] = await tx`select count(*)::int as n,coalesce(sum(a.size),0)::bigint as bytes
      from support_attachments a join support_messages m on m.id=a.message_id join support_tickets t on t.id=m.ticket_id
      where t.user_id=(select user_id from support_tickets where id=${ticketId}) and m.author='user' and a.created_at > now()-interval '24 hours'`;
    if (daily.n + photos.length > 60 || Number(daily.bytes) + bytes > 20*1024*1024) throw conflict('Лимит фото на сегодня исчерпан. Отправьте сообщение текстом или попробуйте завтра.', 'support_photo_daily_limit');
  }

  if (Number(budget.total_bytes) + bytes > 512 * 1024 * 1024) throw conflict('Хранилище фото поддержки заполнено. Отправьте сообщение текстом — оператор поможет.', 'support_photo_storage_full');
  for (const [index, p] of photos.entries()) await tx`
    insert into support_attachments(message_id,name,mime,data,size,width,height,position)
    values(${messageId},${p.name},${p.mime},${p.data},${p.data.length},${p.width},${p.height},${index})`;
}

export async function supportPhotosForMessages(ids: string[]): Promise<Map<string, SupportAttachmentDTO[]>> {
  const result = new Map<string, SupportAttachmentDTO[]>();
  if (!ids.length) return result;
  const rows = await sql()`select id,message_id,name,mime,size,width,height from support_attachments where message_id=any(${ids}::uuid[]) order by message_id,position`;
  for (const row of rows) {
    const item: SupportAttachmentDTO = { id: row.id, name: row.name, mime: row.mime, size: row.size, width: row.width, height: row.height };
    result.set(row.message_id, [...(result.get(row.message_id) ?? []), item]);
  }
  return result;
}

/** This endpoint never exposes a public token or a Telegram/media URL. */
export async function readSupportPhoto(id: string, userId?: string) {
  const [photo] = userId
    ? await sql()`select a.mime,a.data from support_attachments a join support_messages m on m.id=a.message_id join support_tickets t on t.id=m.ticket_id where a.id=${id} and t.user_id=${userId}`
    : await sql()`select mime,data from support_attachments where id=${id}`;
  if (!photo) throw notFound('Фото не найдено');
  return photo as { mime: string; data: Buffer };
}
