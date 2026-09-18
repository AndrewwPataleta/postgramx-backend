import {
  Controller,
  Get,
  Post,
  Version,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { AppService } from './app.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@Controller()
@ApiTags('app')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('hello')
  @ApiOperation({ summary: 'Return hello message' })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get()
  @Version(VERSION_NEUTRAL)
  @ApiOperation({ summary: 'Return API info' })
  getApiInfo() {
    return this.appService.getApiInfo();
  }
}
