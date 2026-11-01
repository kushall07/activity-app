import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  createUploadRequestSchema,
  reorderPhotosRequestSchema,
  upsertProfileRequestSchema,
  type CreatePhotoUploadResponse,
  type CreateSelfieUploadResponse,
  type MeResponse,
  type Photo,
  type Profile,
  type PublicProfile,
  type VerificationResponse,
} from '@activity/shared';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PhotosService } from './photos.service.js';
import { ProfilesService } from './profiles.service.js';
import { VerificationService } from './verification.service.js';

const uuid = new ParseUUIDPipe({ version: '4' });

@Controller()
export class ProfilesController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly photos: PhotosService,
    private readonly verification: VerificationService,
  ) {}

  /** Everything the app needs to decide which onboarding step to show. */
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.profiles.me(user);
  }

  @Put('me/profile')
  upsertProfile(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(upsertProfileRequestSchema))
    body: z.output<typeof upsertProfileRequestSchema>,
  ): Promise<Profile> {
    return this.profiles.upsert(user.id, body);
  }

  @Post('me/photos')
  createPhotoUpload(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createUploadRequestSchema)) body: z.output<typeof createUploadRequestSchema>,
  ): Promise<CreatePhotoUploadResponse> {
    return this.photos.createUpload(user.id, body);
  }

  @Post('me/photos/:id/complete')
  @HttpCode(200)
  completePhoto(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<Photo> {
    return this.photos.complete(user.id, id);
  }

  @Put('me/photos/order')
  async reorderPhotos(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(reorderPhotosRequestSchema))
    body: z.output<typeof reorderPhotosRequestSchema>,
  ): Promise<{ photos: Photo[] }> {
    return { photos: await this.photos.reorder(user.id, body.photoIds) };
  }

  @Delete('me/photos/:id')
  async deletePhoto(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<{ photos: Photo[] }> {
    return { photos: await this.photos.remove(user.id, id) };
  }

  @Post('me/verification/selfie')
  createSelfieUpload(@CurrentUser() user: AuthUser): Promise<CreateSelfieUploadResponse> {
    return this.verification.createUpload(user.id);
  }

  @Post('me/verification/selfie/:id/complete')
  @HttpCode(200)
  completeSelfie(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<VerificationResponse> {
    return this.verification.complete(user.id, id);
  }

  @Get('me/verification/selfie/:id')
  getSelfie(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<VerificationResponse> {
    return this.verification.find(user.id, id);
  }

  @Get('users/:id/profile')
  publicProfile(@Param('id', uuid) id: string): Promise<PublicProfile> {
    return this.profiles.publicProfile(id);
  }
}
