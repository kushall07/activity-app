import { z } from 'zod';

export const DEVICE_PLATFORMS = ['ios', 'android'] as const;

/** Native push token from the OS: an FCM registration token or an APNs device token. */
export const registerDeviceSchema = z.object({
  platform: z.enum(DEVICE_PLATFORMS),
  token: z.string().trim().min(10).max(4096),
});

/** What a notification opens when tapped. */
export const pushDataSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('request.new'), planId: z.string().uuid() }),
  z.object({
    kind: z.literal('request.accepted'),
    planId: z.string().uuid(),
    chatId: z.string().uuid(),
  }),
  z.object({ kind: z.literal('chat.message'), chatId: z.string().uuid() }),
  z.object({ kind: z.literal('plan.cancelled'), planId: z.string().uuid() }),
]);

export type RegisterDevice = z.infer<typeof registerDeviceSchema>;
export type PushData = z.infer<typeof pushDataSchema>;
