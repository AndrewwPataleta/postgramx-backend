import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

const DEFAULT_SENSITIVE_FIELDS = ['passwordHash', 'passwordSalt'];

@Injectable()
export class ResponseSanitizerInterceptor implements NestInterceptor {
  private readonly sensitiveFieldSet: Set<string>;

  constructor(
    private readonly sensitiveFields: string[] = DEFAULT_SENSITIVE_FIELDS,
  ) {
    this.sensitiveFieldSet = new Set(this.sensitiveFields);
  }

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(map((data) => this.sanitize(data)));
  }

  private sanitize<T>(value: T, seen = new WeakSet<object>()): T {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value !== 'object') {
      return value;
    }

    if (
      value instanceof Date ||
      value instanceof RegExp ||
      Buffer.isBuffer(value)
    ) {
      return value;
    }

    if (
      typeof (value as any).pipe === 'function' &&
      typeof (value as any).on === 'function'
    ) {
      return value;
    }

    if (seen.has(value as object)) {
      return value;
    }

    seen.add(value as object);

    if (Array.isArray(value)) {
      const arrayValue = value as unknown as unknown[];
      for (let index = 0; index < arrayValue.length; index += 1) {
        arrayValue[index] = this.sanitize(arrayValue[index], seen);
      }
      return value;
    }

    const record = value as Record<string, unknown>;

    for (const key of Object.keys(record)) {
      if (this.sensitiveFieldSet.has(key)) {
        delete record[key];
        continue;
      }

      record[key] = this.sanitize(record[key], seen);
    }

    return value;
  }
}
