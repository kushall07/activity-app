import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import type { Env } from '../config/env.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CognitoOtpProvider } from './cognito-otp.provider.js';
import { DevOtpProvider } from './dev-otp.provider.js';
import { OTP_PROVIDER, type OtpProvider } from './otp-provider.js';

@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: OTP_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): OtpProvider => {
        if (config.get('AUTH_PROVIDER', { infer: true }) === 'cognito') {
          return new CognitoOtpProvider({
            region: config.get('AWS_REGION', { infer: true }),
            userPoolId: config.get('COGNITO_USER_POOL_ID', { infer: true })!,
            clientId: config.get('COGNITO_CLIENT_ID', { infer: true })!,
            clientSecret: config.get('COGNITO_CLIENT_SECRET', { infer: true })!,
          });
        }
        return new DevOtpProvider(
          config.get('DEV_AUTH_SECRET', { infer: true })!,
          config.get('DEV_OTP_CODE', { infer: true }),
        );
      },
    },
    AuthService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [OTP_PROVIDER],
})
export class AuthModule {}
