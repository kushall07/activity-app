import { Inject, Injectable, Logger } from '@nestjs/common';
import { JOB_TYPES, storageKeys, userPurgePayloadSchema, type JobEnvelope } from '@activity/shared';
import { OBJECT_STORE, type ObjectStore } from '../infra/object-store.js';
import { PlanIndexer } from '../search/plan-indexer.js';
import type { JobHandler } from './job-handler.js';

/**
 * After account deletion, removes every stored object and search document for the user. The bucket is
 * versioned, so noncurrent versions linger for the 30-day lifecycle window and then go.
 */
@Injectable()
export class UserPurgeHandler implements JobHandler {
  readonly type = JOB_TYPES.userPurge;
  private readonly logger = new Logger(UserPurgeHandler.name);

  constructor(
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    private readonly indexer: PlanIndexer,
  ) {}

  async handle(job: JobEnvelope): Promise<void> {
    const { userId } = userPurgePayloadSchema.parse(job.payload);
    let total = 0;
    for (const prefix of storageKeys.userPrefixes(userId)) {
      total += await this.store.deletePrefix(prefix);
    }
    // Their plans were deleted with the account; drop them from search right away.
    const plans = await this.indexer.deleteHost(userId);
    this.logger.log(
      `Purged ${total} objects and ${plans} search documents for deleted user ${userId}`,
    );
  }
}
