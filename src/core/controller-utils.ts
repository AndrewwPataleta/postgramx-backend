import { HttpException, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { I18nContext } from 'nestjs-i18n';

type UserRequest = Request & { user?: { id: string; telegramId?: string } };

export type ErrorHandlingOptions<
  Code,
  ErrorType extends Error & { code: Code; details?: Record<string, unknown> },
> = {
  errorType: new (...args: any[]) => ErrorType;
  mapStatus: (code: Code) => number;
  mapMessageKey: (code: Code) => string;
};

export function assertUser(req: Request) {
  const user = (req as UserRequest).user;
  if (!user) {
    throw new UnauthorizedException();
  }
  return user;
}

export async function handleMappedError<
  Code,
  ErrorType extends Error & { code: Code; details?: Record<string, unknown> },
>(
  error: unknown,
  i18n: I18nContext,
  options: ErrorHandlingOptions<Code, ErrorType>,
): Promise<never> {
  if (error instanceof options.errorType) {
    const status = options.mapStatus(error.code);
    const messageKey = options.mapMessageKey(error.code);
    const message = await i18n.t(messageKey);
    throw new HttpException(
      {
        code: error.code,
        message,
        ...(error.details ? { details: error.details } : {}),
      },
      status,
    );
  }
  throw error;
}
