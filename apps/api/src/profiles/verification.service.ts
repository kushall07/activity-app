import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { profiles, selfieVerifications } from '@activity/db';
import {
  JOB_TYPES,
  PROFILE_RULES,
  storageKeys,
  type CreateSelfieUploadResponse,
  type SelfieVerifyPayload,
  type VerificationResponse,
} from '@activity/shared';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { ApiException } from '../common/errors.js';
import { JobsService } from '../common/jobs.service.js';
import { StorageService } from '../common/storage.service.js';
import { DRIZZLE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { PhotosService } from './photos.service.js';

const MAX_ATTEMPTS_PER_DAY = 5;

type Row = typeof selfieVerifications.$inferSelect;

/**
 * Selfie verification: the member takes a live selfie in the app, the worker
 * compares it with their approved profile photos (Rekognition CompareFaces) and
 * a match earns the "verified" badge. The selfie is deleted after the check.
 */
@Injectable()
export class VerificationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly photos: PhotosService,
  ) {}

  async createUpload(userId: string): Promise<CreateSelfieUploadResponse> {
    const [profile] = await this.db
      .select({ verifiedAt: profiles.verifiedAt })
      .from(profiles)
      .where(eq(profiles.userId, userId));
    if (!profile) {
      throw new ApiException(HttpStatus.CONFLICT, 'needs_profile', 'Create your profile first');
    }
    if (profile.verifiedAt) {
      throw new ApiException(HttpStatus.CONFLICT, 'already_verified', 'You are already verified');
    }
    if ((await this.photos.approvedCount(userId)) === 0) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'needs_photos',
        'Add a clear photo of yourself before verifying',
      );
    }
    const [recent] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(selfieVerifications)
      .where(
        and(
          eq(selfieVerifications.userId, userId),
          gt(selfieVerifications.createdAt, sql`now() - interval '1 day'`),
        ),
      );
    if ((recent?.n ?? 0) >= MAX_ATTEMPTS_PER_DAY) {
      throw new ApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'rate_limited',
        'Too many verification attempts today. Try again tomorrow.',
      );
    }

    const id = randomUUID();
    const uploadKey = storageKeys.selfieUpload(userId, id);
    await this.db.insert(selfieVerifications).values({ id, userId, uploadKey });
    const upload = await this.storage.createUpload(
      uploadKey,
      'image/jpeg',
      PROFILE_RULES.maxPhotoBytes,
    );
    return { verificationId: id, upload };
  }

  async complete(userId: string, id: string): Promise<VerificationResponse> {
    const row = await this.get(userId, id);
    if (row.status !== 'awaiting_upload') return this.toDto(row);
    if (!(await this.storage.head(row.uploadKey))) {
      throw new ApiException(HttpStatus.CONFLICT, 'upload_missing', 'Upload not found, try again');
    }
    const [updated] = await this.db
      .update(selfieVerifications)
      .set({ status: 'processing' })
      .where(and(eq(selfieVerifications.id, id), eq(selfieVerifications.status, 'awaiting_upload')))
      .returning();
    const payload: SelfieVerifyPayload = { verificationId: id };
    await this.jobs.enqueue(JOB_TYPES.selfieVerify, payload, `${JOB_TYPES.selfieVerify}:${id}`);
    return this.toDto(updated ?? row);
  }

  async find(userId: string, id: string): Promise<VerificationResponse> {
    return this.toDto(await this.get(userId, id));
  }

  /** Latest attempt, for the profile screen. */
  async latest(userId: string): Promise<Row | undefined> {
    const [row] = await this.db
      .select()
      .from(selfieVerifications)
      .where(eq(selfieVerifications.userId, userId))
      .orderBy(desc(selfieVerifications.createdAt))
      .limit(1);
    return row;
  }

  private async get(userId: string, id: string): Promise<Row> {
    const [row] = await this.db
      .select()
      .from(selfieVerifications)
      .where(and(eq(selfieVerifications.id, id), eq(selfieVerifications.userId, userId)))
      .limit(1);
    if (!row) throw new ApiException(HttpStatus.NOT_FOUND, 'not_found', 'Verification not found');
    return row;
  }

  private toDto(row: Row): VerificationResponse {
    return { id: row.id, status: row.status, failureReason: row.failureReason };
  }
}
