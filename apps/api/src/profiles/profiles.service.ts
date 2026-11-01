import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { photos, profiles, users } from '@activity/db';
import {
  ageOn,
  PROFILE_RULES,
  storageKeys,
  type MeResponse,
  type Profile,
  type PublicProfile,
  upsertProfileRequestSchema,
} from '@activity/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { AuthUser } from '../auth/decorators.js';
import { ApiException } from '../common/errors.js';
import { StorageService } from '../common/storage.service.js';
import { DRIZZLE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { PhotosService } from './photos.service.js';
import { VerificationService } from './verification.service.js';

type ProfileRow = typeof profiles.$inferSelect;
type UpsertProfile = z.output<typeof upsertProfileRequestSchema>;

@Injectable()
export class ProfilesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly photos: PhotosService,
    private readonly verification: VerificationService,
    private readonly storage: StorageService,
  ) {}

  async me(user: AuthUser): Promise<MeResponse> {
    const [[profile], photoList, latest] = await Promise.all([
      this.db.select().from(profiles).where(eq(profiles.userId, user.id)),
      this.photos.list(user.id),
      this.verification.latest(user.id),
    ]);
    const approvedPhotos = photoList.filter((p) => p.status === 'approved').length;
    return {
      user: { id: user.id, phone: user.phone, createdAt: user.createdAt.toISOString() },
      profile: profile ? this.toProfile(profile) : null,
      photos: photoList,
      verification: profile?.verifiedAt
        ? { status: 'verified', failureReason: null }
        : { status: latest?.status ?? 'none', failureReason: latest?.failureReason ?? null },
      onboarding: {
        hasProfile: !!profile,
        approvedPhotos,
        minPhotos: PROFILE_RULES.minPhotos,
        complete: !!profile && approvedPhotos >= PROFILE_RULES.minPhotos,
      },
    };
  }

  async upsert(userId: string, input: UpsertProfile): Promise<Profile> {
    const values = {
      displayName: input.displayName,
      birthDate: input.birthDate,
      gender: input.gender,
      intent: input.intent,
      bio: input.bio,
      jobTitle: input.jobTitle ?? null,
      education: input.education ?? null,
      neighbourhood: input.neighbourhood ?? null,
      heightCm: input.heightCm ?? null,
      interests: input.interests,
    };
    const [row] = await this.db
      .insert(profiles)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: profiles.userId, set: values })
      .returning();
    return this.toProfile(row!);
  }

  /**
   * Another member's profile. Only complete profiles of active accounts are visible,
   * and only approved photos are ever returned.
   */
  async publicProfile(userId: string): Promise<PublicProfile> {
    const [row] = await this.db
      .select({ profile: profiles })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(and(eq(profiles.userId, userId), eq(users.status, 'active')));
    const approved = row
      ? await this.db
          .select({ id: photos.id, prefix: photos.publicPrefix })
          .from(photos)
          .where(and(eq(photos.userId, userId), eq(photos.status, 'approved')))
          .orderBy(asc(photos.position))
      : [];
    if (!row || approved.length < PROFILE_RULES.minPhotos) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'not_found', 'Profile not found');
    }
    const profile = this.toProfile(row.profile);
    return {
      userId,
      displayName: profile.displayName,
      age: profile.age,
      gender: profile.gender,
      intent: profile.intent,
      bio: profile.bio,
      jobTitle: profile.jobTitle,
      education: profile.education,
      neighbourhood: profile.neighbourhood,
      heightCm: profile.heightCm,
      interests: profile.interests,
      verified: profile.verified,
      photos: approved
        .filter((p): p is { id: string; prefix: string } => !!p.prefix)
        .map((p) => ({
          id: p.id,
          full: this.storage.publicUrl(storageKeys.photoVariant(p.prefix, 'full')),
          thumb: this.storage.publicUrl(storageKeys.photoVariant(p.prefix, 'thumb')),
        })),
    };
  }

  private toProfile(row: ProfileRow): Profile {
    return {
      displayName: row.displayName,
      birthDate: row.birthDate,
      age: ageOn(row.birthDate),
      gender: row.gender,
      intent: row.intent,
      bio: row.bio,
      jobTitle: row.jobTitle,
      education: row.education,
      neighbourhood: row.neighbourhood,
      heightCm: row.heightCm,
      interests: row.interests,
      verified: !!row.verifiedAt,
    };
  }
}
