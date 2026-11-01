import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { LocalImage, Resizer } from './upload';

/**
 * Downscales and re-encodes to JPEG on the device: smaller uploads on mobile data,
 * and HEIC photos from iPhones become JPEG, which the server accepts.
 */
export const resizeToJpeg: Resizer = async (image: LocalImage, maxDimension: number) => {
  const landscape = image.width >= image.height;
  const longest = Math.max(image.width, image.height);
  const actions =
    longest > maxDimension
      ? [{ resize: landscape ? { width: maxDimension } : { height: maxDimension } }]
      : [];
  const out = await manipulateAsync(image.uri, actions, {
    compress: 0.85,
    format: SaveFormat.JPEG,
  });
  return { uri: out.uri, contentType: 'image/jpeg' };
};
