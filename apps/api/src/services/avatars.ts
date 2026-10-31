import { config } from '../config.js';
import { sql } from '../db/index.js';
import { badRequest } from '../lib/errors.js';
import { sniffImage } from './botwelcome.js';
export async function saveAvatar(id:string,data:string){
 const match=/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(data);
 if(!match)throw badRequest('Выберите фото JPG, PNG или WebP');
 const bytes=Buffer.from(match[1]!,'base64');const mime=sniffImage(bytes);
 if(!mime||bytes.length>512*1024)throw badRequest('Фото должно быть JPG, PNG или WebP, до 512 КБ');
 await sql()`insert into user_avatars(user_id,mime,data) values(${id},${mime},${bytes}) on conflict(user_id) do update set mime=excluded.mime,data=excluded.data,token=gen_random_uuid(),version=user_avatars.version+1,updated_at=now()`;
}
export async function avatarData(id:string){const [r]=await sql()`select token from user_avatars where user_id=${id}`;return r?`${config().API_URL.replace(/\/$/,'')}/api/v1/media/avatar/${r.token}`:null;}
