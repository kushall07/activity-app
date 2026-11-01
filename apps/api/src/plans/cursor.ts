import { HttpStatus } from '@nestjs/common';
import type { FeedCursor } from '@activity/search';
import { z } from 'zod';
import { ApiException } from '../common/errors.js';

const cursorSchema = z.discriminatedUnion('s', [
  z.object({ s: z.literal('soonest'), t: z.number().int(), i: z.string().uuid() }),
  z.object({ s: z.literal('nearest'), d: z.number().min(0), i: z.string().uuid() }),
]);

/**
 * Opaque keyset cursor. It holds the sort key of the last item, not an offset,
 * so pages stay stable while new plans are posted, and both the OpenSearch and
 * the Postgres paths can continue from the same cursor.
 */
export function encodeCursor(c: FeedCursor): string {
  const raw =
    c.sort === 'soonest'
      ? { s: c.sort, t: c.startsAtMs, i: c.id }
      : { s: c.sort, d: Math.round(c.distanceM * 1000) / 1000, i: c.id };
  return Buffer.from(JSON.stringify(raw)).toString('base64url');
}

export function decodeCursor(value: string, sort: FeedCursor['sort']): FeedCursor {
  let parsed: z.infer<typeof cursorSchema>;
  try {
    parsed = cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw new ApiException(HttpStatus.BAD_REQUEST, 'invalid_cursor', 'Invalid cursor');
  }
  if (parsed.s !== sort) {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      'invalid_cursor',
      'Cursor is for a different sort order',
    );
  }
  return parsed.s === 'soonest'
    ? { sort: 'soonest', startsAtMs: parsed.t, id: parsed.i }
    : { sort: 'nearest', distanceM: parsed.d, id: parsed.i };
}
