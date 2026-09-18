import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../auth.service';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private readonly authService: AuthService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const platformType = req.body?.platformType || req.query?.platformType;
    const authType = req.body?.authType || req.query?.authType;
    const token = req.body?.token || req.query?.token;

    if (!authType || !token) {
      return next();
    }

    const user = await this.authService.verifyTokenAndGetUser(
      authType,
      token,
      platformType,
    );
    if (user) {
      req.user = user;
    }

    next();
  }
}
