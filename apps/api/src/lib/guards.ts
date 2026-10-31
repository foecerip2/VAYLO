import { log } from './log.js';

/**
 * Защита процесса от падения из-за «забытого» отклонённого промиса (например, сбой БД во время оповещения админов).
 * Необработанное отклонение пишем в лог и продолжаем работу; неперехваченное исключение — логируем и выходим,
 * чтобы Docker перезапустил контейнер в чистом состоянии.
 */
export function installProcessGuards(name: string): void {
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', { proc: name, err: reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : String(reason) });
  });
  process.on('uncaughtException', (e) => {
    log.error('uncaught exception', { proc: name, err: `${e.message}\n${e.stack ?? ''}` });
    setTimeout(() => process.exit(1), 200).unref();
  });
}
