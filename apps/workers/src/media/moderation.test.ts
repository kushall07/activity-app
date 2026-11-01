import { describe, expect, it } from 'vitest';
import { blockedLabel } from './moderation.js';

describe('blockedLabel', () => {
  it('blocks explicit content and violence by category or parent', () => {
    expect(
      blockedLabel([{ name: 'Explicit Nudity', parent: 'Explicit', confidence: 97 }]),
    ).toBeTruthy();
    expect(
      blockedLabel([{ name: 'Weapon Violence', parent: 'Violence', confidence: 90 }]),
    ).toBeTruthy();
  });

  it('allows swimwear, alcohol and clean photos', () => {
    expect(
      blockedLabel([
        { name: 'Swimwear or Underwear', parent: null, confidence: 95 },
        { name: 'Alcohol', parent: null, confidence: 88 },
      ]),
    ).toBeUndefined();
    expect(blockedLabel([])).toBeUndefined();
  });
});
