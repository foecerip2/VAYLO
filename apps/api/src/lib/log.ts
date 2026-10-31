/** Минимальный структурированный логгер для сервисов (вне контекста запроса Fastify). */
type Level = 'info' | 'warn' | 'error';

function write(level: Level, msg: string, data?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'test' && !process.env.LOG_IN_TESTS) return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...(data ?? {}) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, data?: Record<string, unknown>) => write('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write('error', msg, data),
};
