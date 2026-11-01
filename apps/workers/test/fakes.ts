import type { ObjectStore } from '../src/infra/object-store.js';
import type { Moderation, ModerationLabel } from '../src/media/moderation.js';

export class MemoryStore implements ObjectStore {
  readonly bucket = 'test-bucket';
  readonly objects = new Map<
    string,
    { body: Buffer; contentType: string; cacheControl?: string }
  >();

  async get(key: string) {
    return this.objects.get(key)?.body ?? null;
  }
  async put(key: string, body: Buffer, contentType: string, cacheControl?: string) {
    this.objects.set(key, { body, contentType, cacheControl });
  }
  async delete(keys: string[]) {
    for (const k of keys) this.objects.delete(k);
  }
  async deletePrefix(prefix: string) {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix));
    await this.delete(keys);
    return keys.length;
  }
}

export class FakeModeration implements Moderation {
  nextLabels: ModerationLabel[] = [];
  faces = 1;
  similarity = 99;
  compared: string[] = [];

  async labels() {
    return this.nextLabels;
  }
  async countFaces() {
    return this.faces;
  }
  async compareFaces(_: Buffer, target: { key: string }) {
    this.compared.push(target.key);
    return this.similarity;
  }
}
