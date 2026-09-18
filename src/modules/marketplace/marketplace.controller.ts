import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { dtoValidationPipe } from '../../common/pipes/dto-validation.pipe';
import { assertUser } from '../../core/controller-utils';
import { MarketplaceListChannelsDto } from './dto/marketplace-list-channels.dto';
import { MarketplaceService } from './marketplace.service';
import { AuthType } from '../../common/constants/auth/auth-types.constants';
import { PlatformType } from '../../common/constants/platform/platform-types.constants';

@Controller('marketplace')
@ApiTags('marketplace')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Post('channels/list')
  @ApiOperation({
    summary: 'List marketplace channels (all available) with active listings',
  })
  @ApiBody({
    type: MarketplaceListChannelsDto,
    schema: {
      example: {
        platformType: PlatformType.TELEGRAM,
        authType: AuthType.TELEGRAM,
        token: '<initData>',
        data: {
          q: 'crypto',
          verifiedOnly: true,
          page: 1,
          limit: 20,
          sort: 'price_min',
          order: 'asc',
          minSubscribers: 1000,
          tags: ['Crypto', 'Education'],
        },
      },
    },
  })
  async listChannels(
    @Body(dtoValidationPipe) dto: MarketplaceListChannelsDto,
    @Req() req: Request,
  ) {
    const user = assertUser(req);
    return this.marketplaceService.listChannels(dto.data, user.id);
  }
}
