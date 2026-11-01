import { Global, Module } from '@nestjs/common';
import { JobsService } from './jobs.service.js';
import { RateLimiter } from './rate-limiter.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({
  providers: [JobsService, RateLimiter, StorageService],
  exports: [JobsService, RateLimiter, StorageService],
})
export class CommonModule {}
