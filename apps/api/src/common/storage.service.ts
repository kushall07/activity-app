import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  NotFound,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PresignedUpload } from '@activity/shared';
import type { Env } from '../config/env.js';

const UPLOAD_URL_TTL_SECONDS = 300;

/** Thin wrapper over the private photos bucket. Swapped for a fake in e2e tests. */
@Injectable()
export class StorageService implements OnApplicationShutdown {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService<Env, true>) {
    const endpoint = config.get('S3_ENDPOINT', { infer: true });
    this.bucket = config.get('PHOTOS_BUCKET', { infer: true });
    this.publicBaseUrl = config.get('PHOTOS_PUBLIC_BASE_URL', { infer: true }).replace(/\/+$/, '');
    this.s3 = new S3Client({
      region: config.get('AWS_REGION', { infer: true }),
      ...(endpoint
        ? {
            endpoint,
            forcePathStyle: true,
            credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
          }
        : {}),
    });
  }

  /**
   * Presigned POST (not PUT) so S3 itself enforces the size limit and content type:
   * a client cannot upload a 2 GB file or an executable to a photo key.
   */
  async createUpload(key: string, contentType: string, maxBytes: number): Promise<PresignedUpload> {
    const { url, fields } = await createPresignedPost(this.s3, {
      Bucket: this.bucket,
      Key: key,
      Conditions: [
        ['content-length-range', 1, maxBytes],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: UPLOAD_URL_TTL_SECONDS,
    });
    return {
      url,
      fields,
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** Returns object metadata, or null if the client never uploaded it. */
  async head(key: string): Promise<{ contentLength: number; contentType?: string } | null> {
    try {
      const res = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { contentLength: res.ContentLength ?? 0, contentType: res.ContentType };
    } catch (err) {
      if (err instanceof NotFound) return null;
      if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (!keys.length) return;
    await this.s3.send(
      new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }

  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  onApplicationShutdown(): void {
    this.s3.destroy();
  }
}
