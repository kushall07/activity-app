import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
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
      REDIS_URL: base.REDIS_URL,
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
});
