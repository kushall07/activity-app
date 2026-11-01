import { createApiClient } from './api';
import { uploadProfilePhoto } from './photoUpload';
import { postToS3, pollUntil } from './upload';

const upload = {
  url: 'https://bucket.s3.ap-south-1.amazonaws.com/',
  fields: { key: 'incoming/u/p', 'Content-Type': 'image/jpeg', Policy: 'abc' },
  expiresAt: '2026-11-01T00:05:00Z',
};

describe('postToS3', () => {
  it('sends policy fields before the file', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 204 }) as Response);
    await postToS3(upload, { uri: 'file:///p.jpg', contentType: 'image/jpeg' }, fetchImpl);
    const body = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    const keys = [...(body as unknown as { keys: () => Iterable<string> }).keys()];
    expect(keys).toEqual(['key', 'Content-Type', 'Policy', 'file']);
  });

  it('explains a rejected (oversized) upload', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 400 }) as Response);
    await expect(
      postToS3(upload, { uri: 'file:///p.jpg', contentType: 'image/jpeg' }, fetchImpl),
    ).rejects.toThrow(/too large/);
  });
});

describe('uploadProfilePhoto', () => {
  it('resizes, reserves a slot with the real size, uploads, then confirms', async () => {
    const calls: string[] = [];
    const photo = {
      id: '7d1c1b0e-8f5e-4b8a-9a7e-1b2c3d4e5f60',
      position: 0,
      status: 'awaiting_upload',
      urls: null,
      rejectionReason: null,
    };
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === 'file:///small.jpg') return { blob: async () => ({ size: 4321 }) } as Response;
      if (url.endsWith('/v1/me/photos')) {
        expect(JSON.parse(String(init?.body))).toEqual({
          contentType: 'image/jpeg',
          contentLength: 4321,
        });
        return { ok: true, status: 201, json: async () => ({ photo, upload }) } as Response;
      }
      if (url === upload.url) return { ok: true, status: 204 } as Response;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ...photo, status: 'processing' }),
      } as Response;
    });
    const api = createApiClient('http://api.test', fetchImpl as unknown as typeof fetch);
    const resize = jest.fn(async () => ({
      uri: 'file:///small.jpg',
      contentType: 'image/jpeg' as const,
    }));

    const result = await uploadProfilePhoto(
      api,
      { uri: 'file:///big.heic', width: 4000, height: 3000 },
      resize,
      fetchImpl as unknown as typeof fetch,
    );
    expect(resize).toHaveBeenCalledWith(
      { uri: 'file:///big.heic', width: 4000, height: 3000 },
      1600,
    );
    expect(result.status).toBe('processing');
    expect(calls).toEqual([
      'GET file:///small.jpg',
      'POST http://api.test/v1/me/photos',
      `POST ${upload.url}`,
      `POST http://api.test/v1/me/photos/${photo.id}/complete`,
    ]);
  });
});

describe('pollUntil', () => {
  it('returns the first non-null value', async () => {
    let n = 0;
    const value = await pollUntil(async () => (++n === 3 ? 'done' : null), { intervalMs: 1 });
    expect(value).toBe('done');
  });
});
