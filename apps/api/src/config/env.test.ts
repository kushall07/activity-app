import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  DEV_AUTH_SECRET: 'x'.repeat(32),
  PHOTOS_BUCKET: 'photos',
  PHOTOS_PUBLIC_BASE_URL: 'http://localhost:9090/photos',
  SQS_JOBS_QUEUE_URL: 'http://localhost:9324/000000000000/activity-jobs',
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_SSL).toBe(false);
    expect(env.NODE_ENV).toBe('development');
  });

  it('coerces numeric and boolean strings', () => {
    const env = validateEnv({ ...base, PORT: '8080', DATABASE_SSL: 'true' });
    expect(env.PORT).toBe(8080);
    expect(env.DATABASE_SSL).toBe(true);
  });

  it('builds DATABASE_URL from parts and escapes the password', () => {
    const env = validateEnv({
      ...base,
      DATABASE_URL: undefined,
      DB_HOST: 'db.internal',
      DB_NAME: 'activity',
      DB_USER: 'admin',
      DB_PASSWORD: 'p@ss/w:rd',
    });
    expect(env.DATABASE_URL).toBe('postgres://admin:p%40ss%2Fw%3Ard@db.internal:5432/activity');
  });

  it('fails fast with a readable message when required vars are missing', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('refuses the dev auth provider in production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(
      /AUTH_PROVIDER=dev is not allowed in production/,
    );
  });

  it('requires Cognito settings when AUTH_PROVIDER=cognito', () => {
    expect(() => validateEnv({ ...base, AUTH_PROVIDER: 'cognito' })).toThrow(
      /COGNITO_USER_POOL_ID[\s\S]*COGNITO_CLIENT_ID[\s\S]*COGNITO_CLIENT_SECRET/,
    );
    const env = validateEnv({
      ...base,
      NODE_ENV: 'production',
      AUTH_PROVIDER: 'cognito',
      DEV_AUTH_SECRET: undefined,
      COGNITO_USER_POOL_ID: 'ap-south-1_abc',
      COGNITO_CLIENT_ID: 'client',
      COGNITO_CLIENT_SECRET: 'secret',
    });
    expect(env.AUTH_PROVIDER).toBe('cognito');
  });

  it('needs an OpenSearch URL when search is on, and IAM auth in production', () => {
    expect(validateEnv(base).SEARCH_PROVIDER).toBe('postgres');
    expect(() => validateEnv({ ...base, SEARCH_PROVIDER: 'opensearch' })).toThrow(/OPENSEARCH_URL/);
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        AUTH_PROVIDER: 'cognito',
        COGNITO_USER_POOL_ID: 'p',
        COGNITO_CLIENT_ID: 'c',
        COGNITO_CLIENT_SECRET: 's',
        SEARCH_PROVIDER: 'opensearch',
        OPENSEARCH_URL: 'https://search.internal',
        OPENSEARCH_AUTH: 'none',
      }),
    ).toThrow(/OPENSEARCH_AUTH/);
  });
});
