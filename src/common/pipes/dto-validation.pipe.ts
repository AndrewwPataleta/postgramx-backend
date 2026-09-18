import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { buildHttpExceptionPayload } from '../utils/http-exception.util';
import { validateSync, ValidationError } from 'class-validator';
import { plainToInstance } from 'class-transformer';

function flattenValidationErrors(errors: ValidationError[]): string[] {
  return errors
    .map((error) => {
      if (error.constraints) {
        return Object.values(error.constraints);
      }
      if (error.children?.length) {
        return flattenValidationErrors(error.children);
      }
      return [];
    })
    .reduce<string[]>((acc, curr) => acc.concat(curr), []);
}

@Injectable()
export class DtoValidationPipe implements PipeTransform {
  transform<T>(value: T, metadata: ArgumentMetadata): T {
    const { metatype } = metadata;

    if (!metatype || typeof metatype !== 'function') {
      return value;
    }

    const instance = plainToInstance(metatype as any, value ?? {}, {
      enableImplicitConversion: true,
      exposeDefaultValues: true,
    });

    const errors = validateSync(instance as object, {
      whitelist: true,
      forbidUnknownValues: false,
      skipMissingProperties: false,
      forbidNonWhitelisted: false,
      validationError: { target: false, value: false },
    });

    if (errors.length > 0) {
      const messages = flattenValidationErrors(errors);
      throw new BadRequestException(
        buildHttpExceptionPayload('errors.validation_failed', messages),
      );
    }

    return instance as T;
  }
}

export const dtoValidationPipe = new DtoValidationPipe();
