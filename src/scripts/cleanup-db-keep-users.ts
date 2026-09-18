import { AppDataSource } from '../database/datasource';
import { User } from '../modules/auth/entities/user.entity';

const KEEP_ENTITIES = new Set([User]);

function quoteTablePath(tablePath: string): string {
  return tablePath
    .split('.')
    .map((part) => `"${part}"`)
    .join('.');
}

async function cleanupDbKeepUsers(): Promise<void> {
  await AppDataSource.initialize();

  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();

  try {
    const tablePaths = AppDataSource.entityMetadatas
      .filter((metadata) => !KEEP_ENTITIES.has(metadata.target as typeof User))
      .map((metadata) => metadata.tablePath);

    if (tablePaths.length === 0) {
      console.log('No tables to truncate.');
      return;
    }

    const tablesList = tablePaths.map(quoteTablePath).join(', ');
    await queryRunner.query(
      `TRUNCATE TABLE ${tablesList} RESTART IDENTITY CASCADE;`,
    );

    console.log('Database cleaned. Kept only users data.');
  } finally {
    await queryRunner.release();
    await AppDataSource.destroy();
  }
}

cleanupDbKeepUsers().catch((error) => {
  console.error('Failed to cleanup database while keeping users:', error);
  process.exitCode = 1;
});

export { cleanupDbKeepUsers };
