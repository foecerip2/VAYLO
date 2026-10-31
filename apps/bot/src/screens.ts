import type { Context, MiddlewareFn } from 'grammy';

/** Only messages produced while rendering bot menus belong to a screen.
 * API/worker notifications never pass through this middleware and remain in chat.
 */
export function screenNavigation(): MiddlewareFn<Context> {
  const screens = new Map<number, number[]>();
  const pending = new Map<number, Promise<void>>();
  return async (ctx, next) => {
    if (ctx.chat?.type !== 'private' || !ctx.from) return next();
    // Login confirmations are security notices, independent of navigation.
    const action = ctx.callbackQuery?.data ?? '';
    if (/^(?:al:|alk:|al_no$)/.test(action) || /^\/start(?:@\w+)? auth_/.test(ctx.message?.text ?? '')) return next();
    const chatId = ctx.chat.id;
    const prior = pending.get(chatId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(r => { release = r; });
    pending.set(chatId, current);
    await prior;
    try {
      const previous = new Set(screens.get(chatId) ?? []);
      const clicked = ctx.callbackQuery?.message?.message_id;
      if (clicked) previous.add(clicked);
      const rendered: number[] = [];
      let started = false;
      const cleanPrevious = async (remove: (id: number) => Promise<any>) => {
        for (const id of [...previous]) {
          if (rendered.includes(id)) continue;
          const result = await remove(id).catch(() => null);
          if (result?.ok || /message to delete not found|message can't be deleted/i.test(result?.description ?? '')) previous.delete(id);
        }
        screens.set(chatId,[...previous].filter(id=>!rendered.includes(id)).concat(rendered).slice(-100));
      };
      const remember = (id: number) => {
        if (!rendered.includes(id)) rendered.push(id);
        screens.delete(chatId);
        screens.set(chatId, [...previous].filter(id=>!rendered.includes(id)).concat(rendered).slice(-100));
        // Bounded in-memory cache. After a restart, a clicked message is still replaceable.
        if (screens.size > 10_000) screens.delete(screens.keys().next().value!);
      };
      ctx.api.config.use(async (call, method, payload, signal) => {
        const p = payload as any;
        if (Number(p.chat_id) !== chatId) return call(method,payload,signal);
        if (method === 'sendMessage' || method === 'sendPhoto') {
          let result: any;
          const target = clicked ?? [...previous].at(-1);
          // A new checkout needs a new message ID: payment operation keys include it.
          // Reusing one message forever would prevent a later intentional purchase.
          const checkout = p.reply_markup?.inline_keyboard?.some((row: any[]) => row.some(b => /^(?:pay:|adb:|c[pa]:|tpm:)/.test(b.callback_data ?? '')));
          if (!started && method === 'sendMessage' && target && !checkout) {
            try {
              result = await call('editMessageText', { ...p, message_id:target }, signal);
              if (!result.ok && result.description?.includes('message is not modified')) result = {ok:true,result:{message_id:target}};
            } catch { /* Keep the old screen unless a replacement can be sent. */ }
            if (result?.ok) { remember(target); started=true; }
          }
          if (!result?.ok) {
            result = await call(method,payload,signal);
            if (result.ok && result.result?.message_id) { remember(result.result.message_id); started=true; }
          }
          if (result.ok && started) {
            // Delete only known menu messages, after the new screen was successfully rendered.
            await cleanPrevious(id => call('deleteMessage',{chat_id:chatId,message_id:id},signal));
          }
          return result;
        }
        if (method === 'editMessageText' || method === 'editMessageCaption' || method === 'editMessageMedia') {
          let result: any = await call(method,payload,signal);
          if (!result.ok && result.description?.includes('message is not modified')) result = {ok:true,result:{message_id:p.message_id}};
          if (result.ok && typeof p.message_id === 'number') {
            remember(p.message_id); started=true;
            await cleanPrevious(id => call('deleteMessage',{chat_id:chatId,message_id:id},signal));
          }
          return result;
        }
        return call(method,payload,signal);
      });
      await next();
    } finally {
      release();
      if (pending.get(chatId) === current) pending.delete(chatId);
    }
  };
}
