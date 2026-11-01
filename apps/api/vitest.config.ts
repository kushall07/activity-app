import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is needed so Nest's decorator metadata is emitted during tests.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/**/*.e2e.test.ts'],
          env: {
            LOG_LEVEL: 'silent',
            AUTH_PROVIDER: 'dev',
            DEV_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
            OTP_MAX_PER_IP_PER_HOUR: '10000',
            PHOTOS_BUCKET: 'activity-photos-e2e',
            PHOTOS_PUBLIC_BASE_URL: 'https://cdn.e2e.test',
            SQS_JOBS_QUEUE_URL: 'http://localhost:9324/000000000000/activity-jobs',
          },
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
