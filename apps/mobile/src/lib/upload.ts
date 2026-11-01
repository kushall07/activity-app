import type { PhotoContentType, PresignedUpload } from '@activity/shared';
import { ApiError } from './api';

export interface LocalImage {
  uri: string;
  width: number;
  height: number;
}

/** Longest edge we upload. The worker re-encodes to 1600px anyway, so more is wasted data. */
export const UPLOAD_MAX_DIMENSION = 1600;

export type Resizer = (
  image: LocalImage,
  maxDimension: number,
) => Promise<{ uri: string; contentType: PhotoContentType }>;

/** Size of a local file in bytes (needed up front for the presigned POST policy). */
export async function fileSize(uri: string, fetchImpl: typeof fetch = fetch): Promise<number> {
  const blob = await (await fetchImpl(uri)).blob();
  return blob.size;
}

/**
 * POSTs a local file to S3 using a presigned POST. The policy fields must come
 * before the file in the multipart body.
 */
export async function postToS3(
  upload: PresignedUpload,
  file: { uri: string; contentType: string },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const form = new FormData();
  for (const [k, v] of Object.entries(upload.fields)) form.append(k, v);
  // React Native's FormData accepts { uri, name, type } for files.
  form.append('file', {
    uri: file.uri,
    name: 'photo.jpg',
    type: file.contentType,
  } as unknown as Blob);
  let res: Response;
  try {
    res = await fetchImpl(upload.url, { method: 'POST', body: form });
  } catch (err) {
    throw new ApiError(`Upload failed (${(err as Error).message})`);
  }
  if (!res.ok) {
    throw new ApiError(
      res.status === 413 || res.status === 400
        ? 'That photo is too large'
        : 'Upload failed, try again',
      res.status,
    );
  }
}

/** Polls `check` until it returns a non-null value or the attempts run out. */
export async function pollUntil<T>(
  check: () => Promise<T | null>,
  { intervalMs = 1500, attempts = 40 } = {},
): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    const value = await check();
    if (value !== null) return value;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}
