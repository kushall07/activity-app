import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/** Upper bound for anything we download into memory (uploads are capped at 10 MB). */
const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;

export const OBJECT_STORE = Symbol('OBJECT_STORE');

export interface ObjectStore {
  readonly bucket: string;
  /** Returns null when the object does not exist (already processed, or never uploaded). */
  get(key: string): Promise<Buffer | null>;
  put(key: string, body: Buffer, contentType: string, cacheControl?: string): Promise<void>;
  delete(keys: string[]): Promise<void>;
  /** Deletes every object under a prefix. Returns how many were deleted. */
  deletePrefix(prefix: string): Promise<number>;
}

export class S3ObjectStore implements ObjectStore {
  constructor(
    private readonly s3: S3Client,
    readonly bucket: string,
  ) {}

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if ((res.ContentLength ?? 0) > MAX_DOWNLOAD_BYTES) {
        throw new Error(`Object ${key} is too large (${res.ContentLength} bytes)`);
      }
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch (err) {
      if (err instanceof NoSuchKey) return null;
      throw err;
    }
  }

  async put(key: string, body: Buffer, contentType: string, cacheControl?: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
      }),
    );
  }

  async delete(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      if (!batch.length) continue;
      await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
  }

  async deletePrefix(prefix: string): Promise<number> {
    let deleted = 0;
    let token: string | undefined;
    do {
      const page = await this.s3.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [o.Key] : []));
      await this.delete(keys);
      deleted += keys.length;
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return deleted;
  }
}
