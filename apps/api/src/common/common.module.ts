import { Global, Module } from '@nestjs/common';
import { JobsService } from './jobs.service.js';
import { NotifierService } from './notifier.service.js';
import { RateLimiter } from './rate-limiter.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({
  providers: [JobsService, NotifierService, RateLimiter, StorageService],
  exports: [JobsService, NotifierService, RateLimiter, StorageService],
})
export class CommonModule {}
