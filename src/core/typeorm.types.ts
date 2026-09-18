// Re-export TypeORM's internal QueryDeepPartialEntity so update()/set()/upsert()
// payloads can be typed without importing from a deep internal path everywhere.
export type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
