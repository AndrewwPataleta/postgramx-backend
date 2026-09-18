import { Inject, Injectable } from '@nestjs/common';
import {
  DataSource,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  RemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';

@Injectable()
@EventSubscriber()
export class CacheInvalidationSubscriber implements EntitySubscriberInterface {
  private readonly isEnabled: boolean;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
    this.isEnabled =
      this.configService.get('CACHE_INVALIDATION_ENABLED') === 'true';

    if (this.isEnabled) {
      dataSource.subscribers.push(this);
    }
  }

  async afterInsert(event: InsertEvent<unknown>) {
    await this.invalidateCache('insert', event.entity);
  }

  async afterUpdate(event: UpdateEvent<unknown>) {
    await this.invalidateCache('update', event.entity);
  }

  async afterRemove(event: RemoveEvent<unknown>) {
    await this.invalidateCache('remove', event.entity);
  }

  private async invalidateCache(action: string, entity: unknown) {
    if (!this.isEnabled) {
      return;
    }

    try {
      await this.cacheManager.reset();
    } catch {
      return;
    }
  }
}
