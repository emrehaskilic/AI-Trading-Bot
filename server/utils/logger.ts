import { AsyncLocalStorage } from 'async_hooks';
import { NextFunction, Request, Response } from 'express';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogContext = Record<string, unknown>;

type RequestContext = {
  correlationId: string;
};

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const requestContextStore = new AsyncLocalStorage<RequestContext>();
let correlationCounter = 0;

function parseLogLevel(value: string | undefined): LogLevel {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error') {
    return normalized;
  }
  return 'info';
}

const CURRENT_LOG_LEVEL = parseLogLevel(process.env.LOG_LEVEL);

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  if (typeof error === 'object' && error !== null) {
    return { ...(error as Record<string, unknown>) };
  }

  return { message: String(error) };
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Error) {
    return serializeError(value);
  }
  return value;
}

function getCorrelationIdFromContext(): string | null {
  const context = requestContextStore.getStore();
  return context?.correlationId || null;
}

function write(level: LogLevel, event: string, context: LogContext = {}): void {
  if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[CURRENT_LOG_LEVEL]) {
    return;
  }

  const correlationId = getCorrelationIdFromContext();
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(correlationId ? { correlationId } : {}),
    ...context,
  };

  const line = JSON.stringify(payload, jsonReplacer);
  if (level === 'warn' || level === 'error') {
    process.stderr.write(`${line}\n`);
    return;
  }
  process.stdout.write(`${line}\n`);
}

function generateCorrelationId(prefix: string = 'req'): string {
  const nowPart = Date.now().toString(36);
  correlationCounter = (correlationCounter + 1) % 1_000_000;
  const seqPart = correlationCounter.toString(36).padStart(4, '0');
  return `${prefix}-${nowPart}-${seqPart}`;
}

export function getCorrelationId(): string | null {
  return getCorrelationIdFromContext();
}

export const logger = {
  debug(event: string, context?: LogContext): void {
    write('debug', event, context);
  },
  info(event: string, context?: LogContext): void {
    write('info', event, context);
  },
  warn(event: string, context?: LogContext): void {
    write('warn', event, context);
  },
  error(event: string, context?: LogContext): void {
    write('error', event, context);
  },
};

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const incomingHeader = req.header('x-correlation-id') || req.header('X-Correlation-Id');
  const correlationId = incomingHeader && incomingHeader.trim().length > 0
    ? incomingHeader.trim()
    : generateCorrelationId('req');

  res.setHeader('x-correlation-id', correlationId);

  requestContextStore.run({ correlationId }, () => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info('HTTP_REQUEST', {
        method: req.method,
        path: req.originalUrl || req.url,
        status: res.statusCode,
        durationMs: Date.now() - start,
        ip: req.ip || req.socket.remoteAddress || null,
        userAgent: req.headers['user-agent'] || null,
      });
    });
    next();
  });
}
