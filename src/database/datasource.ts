import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { loadEnvConfig } from '../config/env';

loadEnvConfig();

const isProdLike = ['production', 'stage'].includes(process.env.NODE_ENV || '');

const sslConfig = isProdLike
  ? {
      rejectUnauthorized: false,
      ca: fs
        .readFileSync(
          path.join(__dirname, '..', 'certs', 'postgramx-ca-certificate.crt'),
        )
        .toString(),
    }
  : false;

const rawSchema = process.env.POSTGRES_SCHEMA;
const schema = rawSchema?.trim() || process.env.POSTGRES_USER || undefined;

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT),
  username: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  synchronize: false,
  migrationsRun: true,
  entities: [__dirname + '/../modules/**/*.entity.{ts,js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  ssl: sslConfig,
  schema,
  extra: schema ? { searchPath: schema } : undefined,
});
