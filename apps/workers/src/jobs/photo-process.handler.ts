import { Inject, Injectable, Logger } from '@nestjs/common';
import { photos } from '@activity/db';
import {
  JOB_TYPES,
  photoProcessPayloadSchema,
  storageKeys,
  type JobEnvelope,
} from '@activity/shared';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../infra/database.js';
import { OBJECT_STORE, type ObjectStore } from '../infra/object-store.js';
import { InvalidImageError, processPhoto } from '../media/image.js';
import { blockedLabel, MODERATION, type Moderation } from '../media/moderation.js';
import type { JobHandler } from './job-handler.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Turns an uploaded profile photo into served images:
 * decode + strip metadata + resize, moderate, then publish full/thumb under
 * public/ (CloudFront) and delete the original upload.
 */
@Injectable()
export class PhotoProcessHandler implements JobHandler {
  readonly type = JOB_TYPES.photoProcess;
  private readonly logger = new Logger(PhotoProcessHandler.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(MODERATION) private readonly moderation: Moderation,
  ) {}

  async handle(job: JobEnvelope): Promise<void> {
    const { photoId } = photoProcessPayloadSchema.parse(job.payload);
    const [photo] = await this.db.select().from(photos).where(eq(photos.id, photoId));
    // Deleted meanwhile, or a redelivery of a job that already finished: nothing to do.
    if (!photo || photo.status !== 'processing') return;

    const original = await this.store.get(photo.uploadKey);
    if (!original) {
      await this.reject(photoId, photo.uploadKey, 'Upload not found, please try again');
      return;
    }

    let processed;
    try {
      processed = await processPhoto(original);
    } catch (err) {
      if (err instanceof InvalidImageError) {
        await this.reject(photoId, photo.uploadKey, err.message);
        return;
      }
      throw err;
    }

    const labels = await this.moderation.labels(processed.full);
    const blocked = blockedLabel(labels);
    if (blocked) {
      this.logger.log(`Photo ${photoId} rejected by moderation (${blocked.name})`);
      await this.reject(
        photoId,
        photo.uploadKey,
        "This photo doesn't meet our community guidelines",
        labels,
      );
      return;
    }

    const prefix = storageKeys.photoPublicPrefix(photo.userId, photoId);
    await Promise.all([
      this.store.put(
        storageKeys.photoVariant(prefix, 'full'),
        processed.full,
        'image/jpeg',
        IMMUTABLE,
      ),
      this.store.put(
        storageKeys.photoVariant(prefix, 'thumb'),
        processed.thumb,
        'image/jpeg',
        IMMUTABLE,
      ),
    ]);
    const updated = await this.db
      .update(photos)
      .set({
        status: 'approved',
        publicPrefix: prefix,
        width: processed.width,
        height: processed.height,
        moderationLabels: labels,
        rejectionReason: null,
      })
      .where(eq(photos.id, photoId))
      .returning({ id: photos.id });
    if (!updated.length) {
      // Member deleted the photo while we were processing it: don't leave orphans.
      await this.store.delete([
        storageKeys.photoVariant(prefix, 'full'),
        storageKeys.photoVariant(prefix, 'thumb'),
      ]);
    }
    await this.store.delete([photo.uploadKey]);
    this.logger.log(`Photo ${photoId} approved (${processed.width}x${processed.height})`);
  }

  private async reject(photoId: string, uploadKey: string, reason: string, labels?: unknown) {
    await this.db
      .update(photos)
      .set({ status: 'rejected', rejectionReason: reason, moderationLabels: labels ?? null })
      .where(eq(photos.id, photoId));
    await this.store.delete([uploadKey]);
  }
}
