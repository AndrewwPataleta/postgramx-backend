import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { I18nService } from 'nestjs-i18n';
import { MembershipsAutoLinkService } from '../channels/memberships-auto-link.service';
import { AuthType } from '../../common/constants/auth/auth-types.constants';
import { PlatformType } from '../../common/constants/platform/platform-types.constants';
import { isValidIanaTimeZone } from '../../common/time/time.utils';

const isSupportedAuthType = (value: string): value is AuthType =>
  Object.values(AuthType).includes(value as AuthType);

const isSupportedPlatformType = (value: string): value is PlatformType =>
  Object.values(PlatformType).includes(value as PlatformType);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly i18n: I18nService,
    private readonly membershipsAutoLinkService: MembershipsAutoLinkService,
  ) {}

  async verifyTokenAndGetUser(
    authType: string,
    token: string,
    platformType?: string,
    authContext?: {
      timeZone?: string;
      utcOffsetMinutes?: number;
    },
  ): Promise<User | null> {
    const normalizedAuthTypeCandidate = (authType ?? '').trim().toLowerCase();
    if (!isSupportedAuthType(normalizedAuthTypeCandidate)) {
      return null;
    }

    const normalizedAuthType: AuthType = normalizedAuthTypeCandidate;

    const normalizedPlatformCandidate = platformType?.trim().toLowerCase();
    const normalizedPlatformType =
      normalizedPlatformCandidate &&
      isSupportedPlatformType(normalizedPlatformCandidate)
        ? normalizedPlatformCandidate
        : undefined;

    let userId: string | null = null;
    let userInfo: Partial<User> = {};
    let user: User | null = null;

    if (normalizedAuthType === AuthType.TELEGRAM) {
      const parsed = new URLSearchParams(token);
      const rawUserData = parsed.get('user');

      if (!rawUserData) {
        return null;
      }

      let decoded: string;
      try {
        decoded = decodeURIComponent(rawUserData);
      } catch {
        return null;
      }

      let data: Record<string, any>;
      try {
        data = JSON.parse(decoded);
      } catch {
        return null;
      }

      userId = data.id?.toString() ?? null;
      if (!userId) {
        return null;
      }

      const firstName = (data.first_name ?? data.firstName)?.trim();
      const lastName = (data.last_name ?? data.lastName)?.trim();
      const avatar = (data.photo_url ?? data.avatar)?.trim();
      const platformForUser = normalizedPlatformType ?? PlatformType.TELEGRAM;

      const telegramLang = data.language_code?.trim() || 'en';

      userInfo = {
        username: data.username?.trim() || `telegram_user_${userId}`,
        lang: telegramLang,
        isPremium: data.is_premium ?? false,
        platformType: platformForUser,
        firstName,
        lastName,
        avatar,
      };

      user = await this.userRepository.findOne({
        where: { telegramId: userId },
      });
    }

    if (!user) {
      const userPayload: Partial<User> = {
        ...userInfo,
        lang: userInfo.lang?.trim() || 'en',
        platformType: (normalizedPlatformType ??
          userInfo.platformType ??
          normalizedAuthType) as string,
        lastLoginAt: new Date(),
        authType: normalizedAuthType,
      };

      user = this.userRepository.create(userPayload);
    }

    user.lastLoginAt = new Date();

    if (
      normalizedPlatformType &&
      user.platformType !== normalizedPlatformType
    ) {
      user.platformType = normalizedPlatformType;
    } else if (!user.platformType && userInfo.platformType) {
      user.platformType = userInfo.platformType as string;
    }

    if (user.authType !== normalizedAuthType) {
      user.authType = normalizedAuthType;
    }

    if (
      normalizedAuthType === AuthType.TELEGRAM &&
      userId &&
      user.telegramId !== userId
    ) {
      user.telegramId = userId;
    }

    if (userInfo.username && user.username !== userInfo.username) {
      user.username = userInfo.username;
    }
    if (userInfo.firstName && user.firstName !== userInfo.firstName) {
      user.firstName = userInfo.firstName;
    }
    if (userInfo.lastName && user.lastName !== userInfo.lastName) {
      user.lastName = userInfo.lastName;
    }

    if (userInfo.email && user.email !== userInfo.email) {
      user.email = userInfo.email;
    }

    if (
      typeof userInfo.isPremium === 'boolean' &&
      user.isPremium !== userInfo.isPremium
    ) {
      user.isPremium = userInfo.isPremium;
    }

    const resolvedTimeZone = this.resolveTimeZone(
      authContext?.timeZone,
      authContext?.utcOffsetMinutes,
    );

    if (resolvedTimeZone) {
      user.timeZone = resolvedTimeZone;
    }

    user = await this.userRepository.save(user);

    if (normalizedAuthType === AuthType.TELEGRAM && user.telegramId) {
      try {
        await this.membershipsAutoLinkService.autoLinkMembershipsForTelegramAdmin(
          user.id,
          user.telegramId,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to auto-link channel memberships for user ${user.id}: ${String(
            error,
          )}`,
        );
      }
    }

    return user;
  }

  private resolveTimeZone(
    timeZone?: string,
    utcOffsetMinutes?: number,
  ): string | null {
    const normalizedTimeZone = timeZone?.trim();
    if (normalizedTimeZone && isValidIanaTimeZone(normalizedTimeZone)) {
      return normalizedTimeZone;
    }

    if (Number.isInteger(utcOffsetMinutes)) {
      const mapped = this.mapUtcOffsetToIana(utcOffsetMinutes as number);
      if (mapped && isValidIanaTimeZone(mapped)) {
        return mapped;
      }
    }

    return null;
  }

  private mapUtcOffsetToIana(utcOffsetMinutes: number): string | null {
    if (utcOffsetMinutes % 60 !== 0) {
      return null;
    }

    const hours = utcOffsetMinutes / 60;
    if (hours < -14 || hours > 14) {
      return null;
    }

    if (hours === 0) {
      return 'UTC';
    }

    return `Etc/GMT${hours > 0 ? '-' : '+'}${Math.abs(hours)}`;
  }
}
