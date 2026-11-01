import type { PresignedUpload } from '@activity/shared';

/** In-memory S3 stand-in: records presigned uploads and lets tests "upload" objects. */
export class FakeStorage {
  readonly objects = new Map<string, { contentLength: number; contentType: string }>();
  readonly deleted: string[] = [];

  async createUpload(key: string, contentType: string, maxBytes: number): Promise<PresignedUpload> {
    return {
      url: 'https://s3.e2e.test/activity-photos-e2e',
      fields: { key, 'Content-Type': contentType, 'x-max-bytes': String(maxBytes) },
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
  }

  async head(key: string) {
    return this.objects.get(key) ?? null;
  }

  async deleteObjects(keys: string[]) {
    for (const k of keys) {
      this.objects.delete(k);
      this.deleted.push(k);
    }
  }

  publicUrl(key: string) {
    return `https://cdn.e2e.test/${key}`;
  }

  /** Simulates the mobile app POSTing the file to S3. */
  put(key: string, contentType = 'image/jpeg') {
    this.objects.set(key, { contentLength: 1234, contentType });
  }
}

export class FakeJobs {
  readonly enqueued: { type: string; payload: unknown; id?: string }[] = [];

  async enqueue(type: string, payload: unknown, id?: string) {
    this.enqueued.push({ type, payload, id });
  }
}
