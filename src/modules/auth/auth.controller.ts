import {
  Controller,
  Post,
  Body,
  UnauthorizedException,
  Get,
} from '@nestjs/common';
import { I18n, I18nContext } from 'nestjs-i18n';
import { AuthDto } from './dto/auth.dto';

import { AuthService } from './auth.service';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';
import { dtoValidationPipe } from '../../common/pipes/dto-validation.pipe';
import { buildI18nHttpExceptionPayload } from '../../common/utils/http-exception.util';

@Controller('auth')
@ApiTags('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post()
  @ApiOperation({ summary: 'Authenticate user and return user data' })
  @ApiBody({ type: AuthDto })
  async auth(@Body(dtoValidationPipe) dto: AuthDto, @I18n() i18n: I18nContext) {
    const { token, platformType, authType } = dto;

    if (!token || !platformType || !authType) {
      throw new UnauthorizedException(
        await buildI18nHttpExceptionPayload(i18n, 'auth.missing'),
      );
    }

    const user = await this.authService.verifyTokenAndGetUser(
      authType,
      token,
      platformType,
      {
        timeZone: dto.timeZone ?? dto.data?.timeZone,
        utcOffsetMinutes: dto.utcOffsetMinutes ?? dto.data?.utcOffsetMinutes,
      },
    );

    if (!user) {
      throw new UnauthorizedException(
        await buildI18nHttpExceptionPayload(i18n, 'auth.unauthorized'),
      );
    }

    return user;
  }
}
