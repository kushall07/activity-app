import type { ApiClient } from './api';
import { fileSize, postToS3, UPLOAD_MAX_DIMENSION, type LocalImage, type Resizer } from './upload';

/** Resize on device -> reserve slot -> POST to S3 -> confirm. The worker then moderates it. */
export async function uploadProfilePhoto(
  api: ApiClient,
  image: LocalImage,
  resize: Resizer,
  fetchImpl: typeof fetch = fetch,
) {
  const file = await resize(image, UPLOAD_MAX_DIMENSION);
  const contentLength = await fileSize(file.uri, fetchImpl);
  const { photo, upload } = await api.createPhotoUpload({
    contentType: file.contentType,
    contentLength,
  });
  await postToS3(upload, file, fetchImpl);
  return api.completePhoto(photo.id);
}

/** Same pipeline for the verification selfie; returns the verification id to poll. */
export async function uploadSelfie(
  api: ApiClient,
  image: LocalImage,
  resize: Resizer,
  fetchImpl: typeof fetch = fetch,
) {
  const file = await resize(image, UPLOAD_MAX_DIMENSION);
  const { verificationId, upload } = await api.createSelfieUpload();
  await postToS3(upload, file, fetchImpl);
  return api.completeSelfie(verificationId);
}
