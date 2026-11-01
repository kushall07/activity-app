import { lastStoredId, mergeMessages, type ChatMessage } from './chatCache';

const msg = (id: number, o: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  chatId: 'c',
  senderId: 'u',
  kind: 'text',
  body: `m${id}`,
  clientId: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  createdAt: '2030-01-01T00:00:00Z',
  ...o,
});

describe('mergeMessages', () => {
  it('orders by id and drops duplicates from the socket and REST', () => {
    const out = mergeMessages([msg(1), msg(3)], [msg(2), msg(3)]);
    expect(out.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it('replaces a pending send with the stored message', () => {
    const pending = msg(-1, { pending: true, clientId: 'x-1' });
    const merged = mergeMessages([msg(1), pending], [msg(9, { clientId: 'x-1' })]);
    expect(merged.map((m) => [m.id, !!m.pending])).toEqual([
      [1, false],
      [9, false],
    ]);
  });

  it('keeps pending sends after stored messages', () => {
    const pending = msg(-1, { pending: true, clientId: 'x-2' });
    const merged = mergeMessages([pending], [msg(5)]);
    expect(merged.map((m) => m.id)).toEqual([5, -1]);
    expect(lastStoredId(merged)).toBe(5);
  });
});
