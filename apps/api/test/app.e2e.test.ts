/**
 * Boots the real API against Postgres+PostGIS and Redis (docker compose locally,
 * service containers in CI). Requires migrations to have been applied.
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@activity/shared';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { PG_POOL } from '../src/database/database.constants.js';

describe('API (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /health returns liveness without the /v1 prefix', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(healthResponseSchema.parse(res.body).status).toBe('ok');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /health/ready reports postgres (with PostGIS) and redis up', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    const body = healthResponseSchema.parse(res.body);
    expect(body.checks?.postgres?.status).toBe('up');
    expect(body.checks?.postgres?.detail).toMatch(/^postgis /);
    expect(body.checks?.redis?.status).toBe('up');
  });

  it('propagates an incoming x-request-id', async () => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', 'trace-123')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('trace-123');
  });

  it('unknown feature routes live under /v1 and 404', async () => {
    await request(app.getHttpServer()).get('/v1/nope').expect(404);
  });

  it('migrations created the PostGIS-backed schema and geo queries work', async () => {
    const pool = app.get<pg.Pool>(PG_POOL);
    const { rows } = await pool.query<{ km: number }>(
      `select round((st_distance(
         'SRID=4326;POINT(77.6271 12.9352)'::geography,   -- Koramangala
         'SRID=4326;POINT(77.6408 12.9784)'::geography    -- Indiranagar
       ) / 1000)::numeric, 1)::float as km`,
    );
    expect(rows[0]?.km).toBeGreaterThan(4);
    expect(rows[0]?.km).toBeLessThan(6);

    const tables = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining(['users', 'venues']),
    );
  });
});
