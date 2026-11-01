import { Body, Controller, Delete, HttpCode, Post, Req } from '@nestjs/common';
import {
  logoutRequestSchema,
  refreshRequestSchema,
  startOtpRequestSchema,
  verifyOtpRequestSchema,
  type AuthTokens,
  type StartOtpResponse,
  type VerifyOtpResponse,
} from '@activity/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuthService } from './auth.service.js';
import { CurrentUser, Public, type AuthUser } from './decorators.js';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Sends a 6-digit code by SMS. Works for both new and returning members. */
  @Public()
  @Post('auth/otp/start')
  @HttpCode(200)
  start(
    @Body(new ZodPipe(startOtpRequestSchema)) body: z.infer<typeof startOtpRequestSchema>,
    @Req() req: Request,
  ): Promise<StartOtpResponse> {
    return this.auth.start(body.phone, req.ip ?? 'unknown');
  }

  @Public()
  @Post('auth/otp/verify')
  @HttpCode(200)
  verify(
    @Body(new ZodPipe(verifyOtpRequestSchema)) body: z.infer<typeof verifyOtpRequestSchema>,
  ): Promise<VerifyOtpResponse> {
    return this.auth.verify(body.challengeId, body.code);
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  refresh(
    @Body(new ZodPipe(refreshRequestSchema)) body: z.infer<typeof refreshRequestSchema>,
  ): Promise<AuthTokens> {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post('auth/logout')
  @HttpCode(204)
  logout(
    @Body(new ZodPipe(logoutRequestSchema)) body: z.infer<typeof logoutRequestSchema>,
  ): Promise<void> {
    return this.auth.logout(body.refreshToken);
  }

  /** Deletes the account, profile and photos. Irreversible. */
  @Delete('me')
  @HttpCode(204)
  deleteAccount(@CurrentUser() user: AuthUser): Promise<void> {
    return this.auth.deleteAccount(user);
  }
}
