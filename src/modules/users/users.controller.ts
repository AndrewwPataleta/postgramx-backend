import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { dtoValidationPipe } from '../../common/pipes/dto-validation.pipe';
import { assertUser } from '../../core/controller-utils';
import { UserWalletService } from '../payments/wallets/user-wallet.service';
import { UserWalletDto } from './dto/user-wallet.dto';

@Controller('users')
@ApiTags('users')
export class UsersController {
  constructor(private readonly userWalletService: UserWalletService) {}

  @Get('wallet')
  @ApiOperation({ summary: 'Get current user wallet address' })
  async getWallet(@Req() req: Request) {
    const user = assertUser(req);
    const wallet = await this.userWalletService.getWallet(user.id);
    return {
      tonAddress: wallet?.tonAddress ?? null,
      isActive: wallet?.isActive ?? false,
    };
  }

  @Post('wallet')
  @ApiOperation({ summary: 'Set current user wallet address' })
  @ApiBody({ type: UserWalletDto })
  async setWallet(
    @Body(dtoValidationPipe) dto: UserWalletDto,
    @Req() req: Request,
  ) {
    const user = assertUser(req);
    const wallet = await this.userWalletService.setWallet(
      user.id,
      dto.data.tonAddress,
    );
    return {
      tonAddress: wallet.tonAddress,
      isActive: wallet.isActive,
    };
  }
}
