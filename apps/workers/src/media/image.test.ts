import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { InvalidImageError, processPhoto } from './image.js';

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#c86' } });

describe('processPhoto', () => {
  it('resizes, re-encodes as JPEG and strips EXIF (incl. GPS)', async () => {
    const input = await solid(3000, 2000)
      .withExif({ IFD0: { Make: 'Phone', Copyright: 'secret' }, IFD3: { GPSLatitudeRef: 'N' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const out = await processPhoto(input);
    const meta = await sharp(out.full).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBe(1600);
    expect(meta.exif).toBeUndefined();
    expect(out).toMatchObject({ width: 1600, height: 1067 });

    const thumb = await sharp(out.thumb).metadata();
    expect([thumb.width, thumb.height]).toEqual([400, 400]);
  });

  it('applies EXIF orientation so photos are upright', async () => {
    // Orientation 6 = rotate 90deg clockwise: a landscape file shown as portrait.
    const input = await solid(1200, 800).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const out = await processPhoto(input);
    expect(out.width).toBeLessThan(out.height);
  });

  it('accepts PNG and WebP', async () => {
    await expect(processPhoto(await solid(800, 800).png().toBuffer())).resolves.toBeTruthy();
    await expect(processPhoto(await solid(800, 800).webp().toBuffer())).resolves.toBeTruthy();
  });

  it('rejects tiny images, unsupported formats and non-images', async () => {
    await expect(processPhoto(await solid(300, 900).jpeg().toBuffer())).rejects.toThrow(
      /too small/,
    );
    await expect(processPhoto(await solid(800, 800).gif().toBuffer())).rejects.toThrow(
      /JPEG, PNG or WebP/,
    );
    await expect(processPhoto(Buffer.from('%PDF-1.7 not an image'))).rejects.toBeInstanceOf(
      InvalidImageError,
    );
  });
});
