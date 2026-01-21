import * as vscode from 'vscode';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const MAX_DETAIL_LENGTH = 4000;

export default class LoggerService {
  private readonly channel: vscode.OutputChannel;
  private level: LogLevel = 'info';
  private showOnError = true;

  constructor(channelName = 'Authord') {
    this.channel = vscode.window.createOutputChannel(channelName);
    this.refreshConfig();
  }

  refreshConfig(): void {
    const config = vscode.workspace.getConfiguration('authord');
    const levelRaw = config.get<string>('logging.level', 'info');
    this.level = normalizeLevel(levelRaw);
    this.showOnError = config.get<boolean>('logging.showOnError', true);
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  show(preserveFocus = true): void {
    this.channel.show(preserveFocus);
  }

  dispose(): void {
    this.channel.dispose();
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.level]) {
      return;
    }
    const timestamp = new Date().toISOString();
    const detail = formatDetail(data);
    const line = detail
      ? `[${timestamp}] [${level.toUpperCase()}] ${message} ${detail}`
      : `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    this.channel.appendLine(line);
    if (level === 'error' && this.showOnError) {
      this.channel.show(true);
    }
  }
}

let sharedLogger: LoggerService | undefined;

export function getLogger(): LoggerService {
  if (!sharedLogger) {
    sharedLogger = new LoggerService();
  }
  return sharedLogger;
}

function normalizeLevel(value?: string): LogLevel {
  const normalized = (value || '').toLowerCase();
  if (normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error') {
    return normalized;
  }
  return 'info';
}

function formatDetail(data: unknown): string {
  if (data === undefined) return '';
  let payload: unknown = data;
  if (data instanceof Error) {
    payload = {
      name: data.name,
      message: data.message,
      stack: data.stack,
    };
  }
  try {
    return truncate(JSON.stringify(payload));
  } catch {
    return truncate(String(payload));
  }
}

function truncate(value: string): string {
  if (value.length <= MAX_DETAIL_LENGTH) return value;
  return `${value.slice(0, MAX_DETAIL_LENGTH)}...`;
}
