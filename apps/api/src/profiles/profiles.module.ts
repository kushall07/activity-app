import { Module } from '@nestjs/common';
import { PhotosService } from './photos.service.js';
import { ProfilesController } from './profiles.controller.js';
import { ProfilesService } from './profiles.service.js';
import { VerificationService } from './verification.service.js';

@Module({
  controllers: [ProfilesController],
  providers: [ProfilesService, PhotosService, VerificationService],
})
export class ProfilesModule {}
