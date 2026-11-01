import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { photos, profiles } from '@activity/db';
import { ageOn, PROFILE_RULES } from '@activity/shared';
import type { FeedViewer } from '@activity/search';
import { and, count, eq } from 'drizzle-orm';
import { ApiException } from '../common/errors.js';
import { DRIZZLE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';

export interface Viewer extends FeedViewer {
  neighbourhood: string | null;
}

/**
 * The signed-in member as the plans module sees them. Browsing and posting
 * need a complete profile (we filter plans by gender and age, and hosts see who
 * is looking); posting also needs the verified badge.
 */
@Injectable()
export class ViewerService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async require(userId: string, opts: { verified?: boolean } = {}): Promise<Viewer> {
    const [[profile], [photoCount]] = await Promise.all([
      this.db.select().from(profiles).where(eq(profiles.userId, userId)),
      this.db
        .select({ n: count() })
        .from(photos)
        .where(and(eq(photos.userId, userId), eq(photos.status, 'approved'))),
    ]);
    if (!profile || (photoCount?.n ?? 0) < PROFILE_RULES.minPhotos) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'profile_incomplete',
        `Finish your profile (with at least ${PROFILE_RULES.minPhotos} photos) first`,
      );
    }
    if (opts.verified && !profile.verifiedAt) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'verification_required',
        'Verify your profile with a selfie before posting a plan',
      );
    }
    return {
      userId,
      gender: profile.gender,
      age: ageOn(profile.birthDate),
      verified: !!profile.verifiedAt,
      neighbourhood: profile.neighbourhood,
    };
  }
}
