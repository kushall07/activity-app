import sharp, { type Metadata } from 'sharp';

export const IMAGE_RULES = {
  minDimension: 400,
  fullMaxDimension: 1600,
  thumbMaxDimension: 400,
  jpegQuality: 82,
  formats: ['jpeg', 'png', 'webp'] as const,
  /** Keeps a decompression bomb from exhausting worker memory. */
  maxInputPixels: 50_000_000,
};

export class InvalidImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidImageError';
  }
}

export interface ProcessedImage {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

/**
 * Decodes an untrusted upload and re-encodes it as JPEG. Re-encoding drops all
 * metadata (EXIF GPS location, camera serials) and anything smuggled inside the
 * file; `rotate()` first applies the EXIF orientation so photos are upright.
 */
export async function processPhoto(input: Buffer): Promise<ProcessedImage> {
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: IMAGE_RULES.maxInputPixels }).metadata();
  } catch {
    throw new InvalidImageError('That file is not an image we can read');
  }
  if (!meta.format || !(IMAGE_RULES.formats as readonly string[]).includes(meta.format)) {
    throw new InvalidImageError('Use a JPEG, PNG or WebP photo');
  }

  const base = () =>
    sharp(input, { limitInputPixels: IMAGE_RULES.maxInputPixels, pages: 1 }).rotate();

  const { data: full, info } = await base()
    .resize(IMAGE_RULES.fullMaxDimension, IMAGE_RULES.fullMaxDimension, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: IMAGE_RULES.jpegQuality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  if (Math.min(info.width, info.height) < IMAGE_RULES.minDimension) {
    throw new InvalidImageError(
      `Photo is too small. Use one at least ${IMAGE_RULES.minDimension}px on each side.`,
    );
  }

  const thumb = await sharp(full)
    .resize(IMAGE_RULES.thumbMaxDimension, IMAGE_RULES.thumbMaxDimension, { fit: 'cover' })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();

  return { full, thumb, width: info.width, height: info.height };
}
