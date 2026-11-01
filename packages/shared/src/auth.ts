import { z } from 'zod';

/** E.164 phone number, e.g. +919876543210. Clients normalise with `normalizePhone` first. */
export const phoneE164Schema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Phone must be in E.164 format');

export const otpCodeSchema = z.string().regex(/^\d{6}$/, 'Code must be 6 digits');

export const startOtpRequestSchema = z.object({ phone: phoneE164Schema });

export const startOtpResponseSchema = z.object({
  /** Opaque handle for this login attempt; send it back with the code. */
  challengeId: z.string(),
  /** Seconds until the code expires. */
  expiresIn: z.number().int().positive(),
  /** Seconds the client must wait before requesting another code. */
  resendAfter: z.number().int().nonnegative(),
});

export const verifyOtpRequestSchema = z.object({
  challengeId: z.string().min(1),
  code: otpCodeSchema,
});

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Access token lifetime in seconds. */
  expiresIn: z.number().int().positive(),
});

export const verifyOtpResponseSchema = authTokensSchema.extend({
  user: z.object({ id: z.string().uuid(), isNew: z.boolean() }),
});

export const refreshRequestSchema = z.object({ refreshToken: z.string().min(1) });
export const refreshResponseSchema = authTokensSchema;
export const logoutRequestSchema = refreshRequestSchema;

export type StartOtpRequest = z.infer<typeof startOtpRequestSchema>;
export type StartOtpResponse = z.infer<typeof startOtpResponseSchema>;
export type VerifyOtpRequest = z.infer<typeof verifyOtpRequestSchema>;
export type VerifyOtpResponse = z.infer<typeof verifyOtpResponseSchema>;
export type AuthTokens = z.infer<typeof authTokensSchema>;

/** Error body returned by the API for 4xx/5xx responses. */
export const apiErrorSchema = z.object({
  statusCode: z.number(),
  message: z.string(),
  code: z.string().optional(),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
