type LogLevel = 'info' | 'warn' | 'error';

function emit(level: LogLevel, event: string, details: Record<string, unknown> = {}) {
  const entry = { timestamp: new Date().toISOString(), level, event, ...details };
  console[level](JSON.stringify(entry));
}

export const logger = {
  info: (event: string, details?: Record<string, unknown>) => emit('info', event, details),
  warn: (event: string, details?: Record<string, unknown>) => emit('warn', event, details),
  error: (event: string, details?: Record<string, unknown>) => emit('error', event, details),
};
