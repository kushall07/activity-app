import { Inject, Injectable } from '@nestjs/common';
import { devices } from '@activity/db';
import type { RegisterDevice } from '@activity/shared';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';

/** Members can be signed in on several phones; each keeps one row per push token. */
@Injectable()
export class DevicesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * A token belongs to one install. If another member signed in on this phone
   * before, the token moves to the current member and its SNS endpoint is
   * reused (the worker updates it in place).
   */
  async register(userId: string, d: RegisterDevice): Promise<void> {
    await this.db
      .insert(devices)
      .values({ userId, platform: d.platform, token: d.token })
      .onConflictDoUpdate({
        target: devices.token,
        set: { userId, platform: d.platform, updatedAt: sql`now()` },
      });
  }

  async remove(userId: string, token: string): Promise<void> {
    await this.db.delete(devices).where(and(eq(devices.userId, userId), eq(devices.token, token)));
  }
}
