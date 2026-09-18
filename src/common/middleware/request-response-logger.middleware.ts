import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

function safeStringify(value: unknown, maxLen = 10000): string {
  try {
    const stringified = JSON.stringify(value, (_key, val) => {
      if (typeof val === 'string' && val.length > 500) {
        return `${val.slice(0, 500)}…`;
      }
      return val;
    });
    return stringified.length > maxLen
      ? `${stringified.slice(0, maxLen)}…`
      : stringified;
  } catch {
    return String(value);
  }
}

@Injectable()
export class RequestResponseLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl, params, query, body } = req;
    const startedAt = Date.now();
    let responsePayload: unknown = undefined;

    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.json = (payload: unknown) => {
      responsePayload = payload;
      return originalJson(payload);
    };

    res.send = (payload: unknown) => {
      responsePayload = payload;
      return originalSend(payload);
    };

    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      this.logger.log(
        [
          `${method} ${originalUrl}`,
          `status=${res.statusCode}`,
          `durationMs=${durationMs}`,
          `params=${safeStringify(params)}`,
          `query=${safeStringify(query)}`,
          `body=${safeStringify(body)}`,
          `response=${safeStringify(responsePayload)}`,
        ].join(' | '),
      );
    });

    next();
  }
}
