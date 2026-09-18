import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { I18n, I18nContext } from 'nestjs-i18n';
import { dtoValidationPipe } from '../../common/pipes/dto-validation.pipe';
import { assertUser, handleMappedError } from '../../core/controller-utils';
import { CreateListingDto } from './dto/create-listing.dto';
import { ListingsByChannelDto } from './dto/listings-by-channel.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { ListingServiceError } from './errors/listing.errors';
import {
  mapListingErrorToMessageKey,
  mapListingErrorToStatus,
} from './errors/listing.error-mapping';
import { ListingsService } from './listings.service';

@Controller('listings')
@ApiTags('listings')
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  @Post('create')
  @ApiOperation({ summary: 'Create listing for channel' })
  @ApiBody({ type: CreateListingDto })
  async create(
    @Body(dtoValidationPipe) dto: CreateListingDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      return await this.listingsService.createListing(dto.data, user.id);
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: ListingServiceError,
        mapStatus: mapListingErrorToStatus,
        mapMessageKey: mapListingErrorToMessageKey,
      });
    }
  }

  @Post('by-channel')
  @ApiOperation({ summary: 'Get listings for a channel (owner/manage)' })
  @ApiBody({ type: ListingsByChannelDto })
  async listByChannel(
    @Body(dtoValidationPipe) dto: ListingsByChannelDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      return await this.listingsService.listByChannel(
        dto.data.channelId,
        user.id,
        {
          page: dto.data.page,
          limit: dto.data.limit,
          onlyActive: dto.data.onlyActive,
          sort: dto.data.sort,
        },
      );
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: ListingServiceError,
        mapStatus: mapListingErrorToStatus,
        mapMessageKey: mapListingErrorToMessageKey,
      });
    }
  }

  @Post('update')
  @ApiOperation({ summary: 'Update listing for channel (owner/manage)' })
  @ApiBody({ type: UpdateListingDto })
  async updateListing(
    @Body(dtoValidationPipe) dto: UpdateListingDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      return await this.listingsService.updateListing(dto.data, user.id);
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: ListingServiceError,
        mapStatus: mapListingErrorToStatus,
        mapMessageKey: mapListingErrorToMessageKey,
      });
    }
  }
}
