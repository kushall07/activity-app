import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { photos, profiles, selfieVerifications } from '@activity/db';
import {
  JOB_TYPES,
  selfieVerifyPayloadSchema,
  storageKeys,
  type JobEnvelope,
} from '@activity/shared';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import { DRIZZLE, type Database } from '../infra/database.js';
import { OBJECT_STORE, type ObjectStore } from '../infra/object-store.js';
import { InvalidImageError, processPhoto } from '../media/image.js';
import { MODERATION, type Moderation } from '../media/moderation.js';
import type { JobHandler } from './job-handler.js';

/**
 * Compares a verification selfie with the member's approved photos. A match above
 * SELFIE_MATCH_THRESHOLD sets profiles.verified_at (the "verified" badge).
 * The selfie is biometric data, so it is deleted as soon as the check is done.
 */
@Injectable()
export class SelfieVerifyHandler implements JobHandler {
  readonly type = JOB_TYPES.selfieVerify;
  private readonly logger = new Logger(SelfieVerifyHandler.name);
  private readonly threshold: number;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(MODERATION) private readonly moderation: Moderation,
    config: ConfigService<Env, true>,
  ) {
    this.threshold = config.get('SELFIE_MATCH_THRESHOLD', { infer: true });
  }

  async handle(job: JobEnvelope): Promise<void> {
    const { verificationId } = selfieVerifyPayloadSchema.parse(job.payload);
    const [row] = await this.db
      .select()
      .from(selfieVerifications)
      .where(eq(selfieVerifications.id, verificationId));
    if (!row || row.status !== 'processing') return;

    try {
      const raw = await this.store.get(row.uploadKey);
      if (!raw) return await this.fail(verificationId, 'Selfie not found, please try again');

      let selfie: Buffer;
      try {
        selfie = (await processPhoto(raw)).full;
      } catch (err) {
        if (err instanceof InvalidImageError) return await this.fail(verificationId, err.message);
        throw err;
      }

      const faces = await this.moderation.countFaces(selfie);
      if (faces !== 1) {
        return await this.fail(
          verificationId,
          faces === 0
            ? "We couldn't see your face clearly. Try again in good light."
            : 'Make sure only you are in the selfie.',
        );
      }

      const targets = await this.db
        .select({ prefix: photos.publicPrefix })
        .from(photos)
        .where(
          and(
            eq(photos.userId, row.userId),
            eq(photos.status, 'approved'),
            isNotNull(photos.publicPrefix),
          ),
        )
        .orderBy(asc(photos.position));

      let best = 0;
      for (const t of targets) {
        const similarity = await this.moderation.compareFaces(selfie, {
          bucket: this.store.bucket,
          key: storageKeys.photoVariant(t.prefix!, 'full'),
        });
        best = Math.max(best, similarity);
        if (best >= this.threshold) break;
      }

      if (best >= this.threshold) {
        await this.db.transaction(async (tx) => {
          await tx
            .update(selfieVerifications)
            .set({ status: 'verified', similarity: best, failureReason: null })
            .where(eq(selfieVerifications.id, verificationId));
          await tx
            .update(profiles)
            .set({ verifiedAt: new Date() })
            .where(eq(profiles.userId, row.userId));
        });
        this.logger.log(`Verification ${verificationId} passed`);
      } else {
        await this.fail(
          verificationId,
          "Your selfie didn't match your profile photos. Make sure your photos clearly show you.",
          best,
        );
      }
    } finally {
      await this.store.delete([row.uploadKey]);
    }
  }

  private async fail(id: string, reason: string, similarity?: number): Promise<void> {
    await this.db
      .update(selfieVerifications)
      .set({ status: 'failed', failureReason: reason, similarity: similarity ?? null })
      .where(eq(selfieVerifications.id, id));
  }
}
