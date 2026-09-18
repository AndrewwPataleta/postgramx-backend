import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { PostAnalyticsService } from './post-analytics.service';
import { POST_ANALYTICS_CONFIG_DEFAULTS } from '../../../common/constants/post-analytics/post-analytics.constants';

@Injectable()
export class PostAnalyticsCronService {
  constructor(
    private readonly postAnalyticsService: PostAnalyticsService,
    private readonly dataSource: DataSource,
  ) {}

  @Cron(
    process.env.POST_ANALYTICS_SAMPLE_CRON_SECONDS ||
      POST_ANALYTICS_CONFIG_DEFAULTS.SAMPLE_CRON,
  )
  async sampleViewsCron(): Promise<void> {
    const acquired = await this.tryLock('post-analytics:sample');
    if (!acquired) {
      return;
    }
    try {
      await this.postAnalyticsService.sampleActiveBatch(50);
    } finally {
      await this.unlock('post-analytics:sample');
    }
  }

  @Cron(
    process.env.POST_ANALYTICS_FINALIZE_CRON_SECONDS ||
      POST_ANALYTICS_CONFIG_DEFAULTS.FINALIZE_CRON,
  )
  async finalizeCron(): Promise<void> {
    const acquired = await this.tryLock('post-analytics:finalize');
    if (!acquired) {
      return;
    }
    try {
      await this.postAnalyticsService.finalizeDueBatch(50);
    } finally {
      await this.unlock('post-analytics:finalize');
    }
  }

  private async tryLock(key: string): Promise<boolean> {
    const result = await this.dataSource.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) as locked',
      [key],
    );
    return Boolean(result?.[0]?.locked);
  }

  private async unlock(key: string): Promise<void> {
    await this.dataSource.query('SELECT pg_advisory_unlock(hashtext($1))', [
      key,
    ]);
  }
}
