import { z } from 'zod';

export const PROFILE_RULES = {
  minAge: 18,
  maxAge: 100,
  /** Photos needed before a profile is shown to anyone. */
  minPhotos: 3,
  maxPhotos: 6,
  bioMaxLength: 300,
  maxInterests: 10,
  /** Upload size limit enforced by the presigned POST policy. */
  maxPhotoBytes: 10 * 1024 * 1024,
  photoContentTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
} as const;

export const GENDERS = ['woman', 'man', 'nonbinary'] as const;
export const INTENTS = ['date', 'friends', 'either'] as const;

export const genderSchema = z.enum(GENDERS);
export const intentSchema = z.enum(INTENTS);

/** Whole years between an ISO date (YYYY-MM-DD) and `today`. */
export function ageOn(birthDate: string, today: Date = new Date()): number {
  const [y, m, d] = birthDate.split('-').map(Number) as [number, number, number];
  let age = today.getUTCFullYear() - y;
  const beforeBirthday =
    today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
      new Date(`${s}T00:00:00Z`).toISOString().startsWith(s),
    'Not a real date',
  );

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  trimmed(max)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional();

export const upsertProfileRequestSchema = z.object({
  displayName: trimmed(40).min(1, 'Name is required'),
  birthDate: isoDate.refine((d) => {
    const age = ageOn(d);
    return age >= PROFILE_RULES.minAge && age <= PROFILE_RULES.maxAge;
  }, `You must be at least ${PROFILE_RULES.minAge} to use the app`),
  gender: genderSchema,
  intent: intentSchema.default('either'),
  bio: trimmed(PROFILE_RULES.bioMaxLength).default(''),
  jobTitle: optionalText(60),
  education: optionalText(80),
  neighbourhood: optionalText(60),
  heightCm: z.number().int().min(120).max(230).nullable().optional(),
  interests: z
    .array(trimmed(30).min(1))
    .max(PROFILE_RULES.maxInterests)
    .default([])
    .transform((list) => [...new Set(list.map((s) => s.toLowerCase()))]),
});

export const photoStatusSchema = z.enum(['awaiting_upload', 'processing', 'approved', 'rejected']);

export const photoSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int().nonnegative(),
  status: photoStatusSchema,
  /** Present once approved: CDN URLs for the processed images. */
  urls: z.object({ full: z.string().url(), thumb: z.string().url() }).nullable(),
  rejectionReason: z.string().nullable(),
});

export const profileSchema = z.object({
  displayName: z.string(),
  birthDate: z.string(),
  age: z.number().int(),
  gender: genderSchema,
  intent: intentSchema,
  bio: z.string(),
  jobTitle: z.string().nullable(),
  education: z.string().nullable(),
  neighbourhood: z.string().nullable(),
  heightCm: z.number().int().nullable(),
  interests: z.array(z.string()),
  verified: z.boolean(),
});

export const verificationStatusSchema = z.enum([
  'none',
  'awaiting_upload',
  'processing',
  'verified',
  'failed',
]);

export const meResponseSchema = z.object({
  user: z.object({ id: z.string().uuid(), phone: z.string(), createdAt: z.string() }),
  profile: profileSchema.nullable(),
  photos: z.array(photoSchema),
  verification: z.object({
    status: verificationStatusSchema,
    failureReason: z.string().nullable(),
  }),
  onboarding: z.object({
    hasProfile: z.boolean(),
    approvedPhotos: z.number().int(),
    minPhotos: z.number().int(),
    /** Profile is visible to others once complete. */
    complete: z.boolean(),
  }),
});

/** What other members see. Never includes phone, birth date or unapproved photos. */
export const publicProfileSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  age: z.number().int(),
  gender: genderSchema,
  intent: intentSchema,
  bio: z.string(),
  jobTitle: z.string().nullable(),
  education: z.string().nullable(),
  neighbourhood: z.string().nullable(),
  heightCm: z.number().int().nullable(),
  interests: z.array(z.string()),
  verified: z.boolean(),
  photos: z.array(
    z.object({ id: z.string().uuid(), full: z.string().url(), thumb: z.string().url() }),
  ),
});

export const photoContentTypeSchema = z.enum(PROFILE_RULES.photoContentTypes);

export const createUploadRequestSchema = z.object({
  contentType: photoContentTypeSchema,
  contentLength: z.number().int().positive().max(PROFILE_RULES.maxPhotoBytes),
});

/** S3 presigned POST: send `fields` then the file as multipart/form-data to `url`. */
export const presignedUploadSchema = z.object({
  url: z.string().url(),
  fields: z.record(z.string(), z.string()),
  expiresAt: z.string(),
});

export const createPhotoUploadResponseSchema = z.object({
  photo: photoSchema,
  upload: presignedUploadSchema,
});

export const reorderPhotosRequestSchema = z.object({
  photoIds: z.array(z.string().uuid()).min(1).max(PROFILE_RULES.maxPhotos),
});

export const photosResponseSchema = z.object({ photos: z.array(photoSchema) });

export const createSelfieUploadResponseSchema = z.object({
  verificationId: z.string().uuid(),
  upload: presignedUploadSchema,
});

export const verificationResponseSchema = z.object({
  id: z.string().uuid(),
  status: verificationStatusSchema,
  failureReason: z.string().nullable(),
});

export type UpsertProfileRequest = z.input<typeof upsertProfileRequestSchema>;
export type Photo = z.infer<typeof photoSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type PublicProfile = z.infer<typeof publicProfileSchema>;
export type PresignedUpload = z.infer<typeof presignedUploadSchema>;
export type CreateUploadRequest = z.infer<typeof createUploadRequestSchema>;
export type CreatePhotoUploadResponse = z.infer<typeof createPhotoUploadResponseSchema>;
export type CreateSelfieUploadResponse = z.infer<typeof createSelfieUploadResponseSchema>;
export type VerificationResponse = z.infer<typeof verificationResponseSchema>;
export type PhotoContentType = z.infer<typeof photoContentTypeSchema>;
