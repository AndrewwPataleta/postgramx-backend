import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { dtoValidationPipe } from '../../common/pipes/dto-validation.pipe';
import { assertUser } from '../../core/controller-utils';
import { ChannelModeratorsService } from './channel-moderators.service';
import { ListChannelModeratorsDto } from './dto/list-channel-moderators.dto';
import { SetReviewEnabledDto } from './dto/set-review-enabled.dto';

@Controller('channels')
@ApiTags('channels')
export class ChannelModeratorsController {
  constructor(
    private readonly channelModeratorsService: ChannelModeratorsService,
  ) {}

  @Get(':channelId/moderators')
  @ApiOperation({ summary: 'List channel moderators' })
  async listByChannel(
    @Param('channelId') channelId: string,
    @Req() req: Request,
  ) {
    const user = assertUser(req);
    return this.channelModeratorsService.listModerators(channelId, user.id);
  }

  @Patch(':channelId/moderators/:telegramUserId')
  @ApiOperation({ summary: 'Enable or disable deal review for a moderator' })
  async setByTelegramUser(
    @Param('channelId') channelId: string,
    @Param('telegramUserId') telegramUserId: string,
    @Body() body: { canReviewDeals?: boolean },
    @Req() req: Request,
  ) {
    const user = assertUser(req);
    if (body?.canReviewDeals === undefined) {
      throw new BadRequestException('Invalid request payload.');
    }
    return this.channelModeratorsService.setReviewEnabledByTelegramUser(
      channelId,
      user.id,
      telegramUserId,
      body.canReviewDeals,
    );
  }

  @Post('moderators/list')
  @ApiOperation({ summary: 'List channel moderators' })
  @ApiBody({ type: ListChannelModeratorsDto })
  async list(
    @Body(dtoValidationPipe) dto: ListChannelModeratorsDto,
    @Req() req: Request,
  ) {
    const user = assertUser(req);
    return this.channelModeratorsService.listModerators(
      dto.data.channelId,
      user.id,
    );
  }

  @Post('moderators/set-review-enabled')
  @ApiOperation({ summary: 'Enable or disable deal review for a moderator' })
  @ApiBody({ type: SetReviewEnabledDto })
  async setReviewEnabled(
    @Body(dtoValidationPipe) dto: SetReviewEnabledDto,
    @Req() req: Request,
  ) {
    const user = assertUser(req);
    const payload = dto.data ?? dto;
    if (
      !payload.channelId ||
      !payload.userId ||
      payload.canReviewDeals === undefined
    ) {
      throw new BadRequestException('Invalid request payload.');
    }
    return this.channelModeratorsService.setReviewEnabled(
      payload.channelId,
      user.id,
      payload.userId,
      payload.canReviewDeals,
    );
  }
}
