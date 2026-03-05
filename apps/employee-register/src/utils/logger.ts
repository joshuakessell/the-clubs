export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private format(level: LogLevel, args: any[]) {
    const timestamp = new Date().toISOString();
    
    let color = '';
    switch (level) {
      case 'debug': color = '#6b7280'; break;
      case 'info': color = '#3b82f6'; break;
      case 'warn': color = '#f59e0b'; break;
      case 'error': color = '#ef4444'; break;
    }

    const prefix = `%c[${timestamp}] [${level.toUpperCase()}]`;
    const style = `color: ${color}; font-weight: bold`;

    return [prefix, style, ...args];
  }

  debug(...args: any[]) {
    if (import.meta.env.DEV) {
      console.debug(...this.format('debug', args));
    }
  }

  info(...args: any[]) {
    console.info(...this.format('info', args));
  }

  warn(...args: any[]) {
    console.warn(...this.format('warn', args));
  }

  error(...args: any[]) {
    console.error(...this.format('error', args));
  }
}

export const logger = new Logger();
