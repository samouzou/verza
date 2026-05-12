
/**
 * Safe logger for Electron's main process.
 * Prevents EPIPE crashes when stdout/stderr pipes break after window launch.
 */
function safeWrite(method: 'log' | 'warn' | 'error', ...args: any[]) {
  try {
    console[method](...args);
  } catch (e: any) {
    if (e.code !== 'EPIPE') throw e;
  }
}

export const logger = {
  log: (...args: any[]) => safeWrite('log', ...args),
  warn: (...args: any[]) => safeWrite('warn', ...args),
  error: (...args: any[]) => safeWrite('error', ...args),
};
