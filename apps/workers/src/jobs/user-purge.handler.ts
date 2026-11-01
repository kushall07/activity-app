import { Inject, Injectable, Logger } from '@nestjs/common';
import { JOB_TYPES, storageKeys, userPurgePayloadSchema, type JobEnvelope } from '@activity/shared';
import { OBJECT_STORE, type ObjectStore } from '../infra/object-store.js';
import type { JobHandler } from './job-handler.js';

/**
 * After account deletion, removes every stored object for the user. The bucket is
 * versioned, so noncurrent versions linger for the 30-day lifecycle window and then go.
 */
@Injectable()
export class UserPurgeHandler implements JobHandler {
  readonly type = JOB_TYPES.userPurge;
  private readonly logger = new Logger(UserPurgeHandler.name);

  constructor(@Inject(OBJECT_STORE) private readonly store: ObjectStore) {}

  async handle(job: JobEnvelope): Promise<void> {
    const { userId } = userPurgePayloadSchema.parse(job.payload);
    let total = 0;
    for (const prefix of storageKeys.userPrefixes(userId)) {
      total += await this.store.deletePrefix(prefix);
    }
    this.logger.log(`Purged ${total} objects for deleted user ${userId}`);
  }
}
