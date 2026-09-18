import { DataSource } from 'typeorm';

export async function withAdvisoryLock<T>(
  dataSource: DataSource,
  key: string,
  task: () => Promise<T>,
): Promise<T | null> {
  const lockKey = `payments:${key}`;
  const acquired = await tryAdvisoryLock(dataSource, lockKey);
  if (!acquired) {
    return null;
  }
  try {
    return await task();
  } finally {
    await releaseAdvisoryLock(dataSource, lockKey);
  }
}

async function tryAdvisoryLock(
  dataSource: DataSource,
  key: string,
): Promise<boolean> {
  const result = await dataSource.query(
    'SELECT pg_try_advisory_lock(hashtext($1)) as locked',
    [key],
  );
  return Boolean(result?.[0]?.locked);
}

async function releaseAdvisoryLock(
  dataSource: DataSource,
  key: string,
): Promise<void> {
  await dataSource.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
}
