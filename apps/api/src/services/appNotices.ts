import { z } from 'zod';
import { CLIENT_APP_IDS,CLIENT_OS_IDS,CLIENT_APP_NAMES,CLIENT_APP_STATUS } from '@vpn/shared';
import { config } from '../config.js';
import { escapeHtml,badRequest } from '../lib/errors.js';
import { getSettings } from './settings.js';
export const appNoticeSchema=z.object({os:z.enum(['all',...CLIENT_OS_IDS]),affected:z.array(z.enum(CLIENT_APP_IDS)).min(1).max(5),alternative:z.enum(CLIENT_APP_IDS)});
export async function appNoticeDraft(input:z.infer<typeof appNoticeSchema>){
 const cfg=await getSettings('client_apps');
 if(input.os==='all'){
  const sections=['ios','android'].map(os=>{
   const entries=cfg.entries.filter(e=>e.os===os);
   const recommended=entries.filter(e=>e.recommended&&e.status!=='removed');
   if(!recommended.length)throw badRequest('Сначала сохраните рекомендации и для iPhone, и для Android');
   const lines=entries.map(e=>`• ${CLIENT_APP_NAMES[e.id]}: ${CLIENT_APP_STATUS[e.status]}${e.recommended?' · рекомендуем':''}${e.note?' — '+escapeHtml(e.note.slice(0,20)):''}`).join('\n');
   return `<b>${os==='ios'?'iPhone / iPad':'Android'}</b>\n${lines}`;
  });
  return {text:`📱 <b>Приложения для подключения VPN</b>\n\nПо информации администрации сервиса:\n\n${sections.join('\n\n')}\n\n<b>Что делать</b>\nСохраните установленное приложение и вашу ссылку подписки. Недоступность в магазине сама по себе не означает прекращение работы установленного приложения.\n\nЕсли нужен другой клиент:\n1. Откройте инструкцию по кнопке ниже.\n2. Выберите своё устройство и рекомендованное приложение.\n3. Установите его по ссылке в инструкции.\n4. Добавьте прежнюю подписку и выберите локацию. Повторно покупать доступ не нужно.\n\nДоступность магазина зависит от региона аккаунта. При лимите устройств проверьте свободные места и передачу HWID. Если подписка не обновляется, пришлите поддержке точный текст ошибки.`,buttonText:'📲 Установка и подключение',buttonUrl:config().APP_URL.replace(/\/$/,'')+'/connect'};
 }

 const get=(id:string)=>cfg.entries.find(e=>e.id===id&&e.os===input.os);
 const alt=get(input.alternative);
 if(alt?.status==='removed')throw badRequest('Выберите доступную альтернативу');
 if(input.os==='linux'&&input.alternative==='happ')throw badRequest('Happ не поддерживает эту платформу');
 if((input.os==='android'||input.os==='windows'||input.os==='linux')&&input.alternative==='streisand')throw badRequest('Streisand не поддерживает эту платформу');
 const os=({ios:'iPhone / iPad',android:'Android',windows:'Windows',macos:'macOS',linux:'Linux'})[input.os];
 const lines=[...new Set(input.affected)].map(id=>{const e=get(id);return `• <b>${CLIENT_APP_NAMES[id]}</b>: ${CLIENT_APP_STATUS[e?.status??'unknown']}${e?.note?' — '+escapeHtml(e.note.slice(0,60)):''}`;});
 const name=CLIENT_APP_NAMES[input.alternative];
 const text=`📱 <b>Приложения для ${os}</b>\n\nПо информации администрации сервиса:\n${lines.join('\n')}\n\n<b>Что делать</b>\nСохраните установленное приложение и вашу ссылку подписки. Недоступность в магазине сама по себе не означает прекращение работы установленного приложения.\n\nЕсли нужен другой клиент, рекомендуем <b>${name}</b>${alt?.status==='unknown'||!alt?' (наличие в магазине ещё не проверено)':alt.status==='regional'?' (доступность зависит от региона аккаунта)':''}.\n1. Откройте инструкцию по кнопке ниже и выберите ${name}.\n2. Установите приложение по ссылке в инструкции.\n3. Добавьте свою прежнюю подписку и выберите локацию. Повторно покупать доступ не нужно.\n\nПри лимите устройств проверьте свободные места и передачу HWID. Если подписка не обновляется, отправьте поддержке точный текст ошибки. Смена клиента не исправляет недоступность сервера подписок.`;
 return {text,buttonText:'📲 Установка и подключение',buttonUrl:config().APP_URL.replace(/\/$/,'')+'/connect?os='+input.os+'&client='+input.alternative};
}
