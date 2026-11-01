import { backoffMs, RealtimeClient, socketUrl } from './realtime';

const CHAT = '0b5c6a7d-1e2f-4a3b-8c9d-0e1f2a3b4c5d';
const CLIENT = '6f1c1b0e-8f5e-4b8a-9a7e-1b2c3d4e5f60';
const USER = '1a2b3c4d-1e2f-4a3b-8c9d-0e1f2a3b4c5d';

class FakeSocket {
  readyState = 0;
  sent: unknown[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const flush = () => new Promise<void>((r) => setImmediate(() => r()));

function setup() {
  const sockets: FakeSocket[] = [];
  const timers: (() => void)[] = [];
  const tokens: boolean[] = [];
  const frames: unknown[] = [];
  let ready = 0;
  const client = new RealtimeClient({
    url: 'ws://api/v1/ws',
    getToken: async (force) => {
      tokens.push(force);
      return 'token';
    },
    onFrame: (f) => frames.push(f),
    onReady: () => ready++,
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s as never;
    },
    setTimer: (fn) => (timers.push(fn), timers.length),
    clearTimer: () => undefined,
  });
  return { client, sockets, timers, tokens, frames, ready: () => ready };
}

const message = {
  id: 7,
  chatId: CHAT,
  senderId: USER,
  kind: 'text',
  body: 'hi',
  clientId: CLIENT,
  createdAt: '2030-01-01T00:00:00.000Z',
};

describe('RealtimeClient', () => {
  it('authenticates with the first frame and resolves sends on ack', async () => {
    const t = setup();
    t.client.start();
    await flush();
    const s = t.sockets[0]!;
    s.open();
    expect(s.sent[0]).toEqual({ type: 'auth', token: 'token' });
    s.receive({ type: 'ready', userId: USER });
    expect(t.client.connected).toBe(true);
    expect(t.ready()).toBe(1);

    const sent = t.client.sendMessage(CHAT, CLIENT, 'hi');
    expect(s.sent[1]).toEqual({ type: 'send', chatId: CHAT, clientId: CLIENT, body: 'hi' });
    s.receive({ type: 'ack', clientId: CLIENT, message });
    await expect(sent).resolves.toMatchObject({ id: 7 });
  });

  it('rejects a send the server refuses', async () => {
    const t = setup();
    t.client.start();
    await flush();
    t.sockets[0]!.open();
    t.sockets[0]!.receive({ type: 'ready', userId: USER });
    const sent = t.client.sendMessage(CHAT, CLIENT, 'hi');
    t.sockets[0]!.receive({
      type: 'error',
      code: 'rate_limited',
      message: 'Slow down',
      clientId: CLIENT,
    });
    await expect(sent).rejects.toThrow('Slow down');
  });

  it('reconnects after a drop and refreshes the token after a 4401', async () => {
    const t = setup();
    t.client.start();
    await flush();
    t.sockets[0]!.open();
    t.sockets[0]!.receive({ type: 'ready', userId: USER });
    t.sockets[0]!.drop(4401);
    expect(t.client.connected).toBe(false);
    expect(t.timers).toHaveLength(1);
    t.timers[0]!();
    await flush();
    expect(t.tokens).toEqual([false, true]);
    expect(t.sockets).toHaveLength(2);
    t.sockets[1]!.open();
    t.sockets[1]!.receive({ type: 'ready', userId: USER });
    expect(t.ready()).toBe(2);
  });

  it('does not reconnect once stopped', async () => {
    const t = setup();
    t.client.start();
    await flush();
    t.client.stop();
    t.sockets[0]!.drop();
    expect(t.timers).toHaveLength(0);
  });
});

describe('helpers', () => {
  it('derives the socket URL from the API URL', () => {
    expect(socketUrl('https://api.example.com')).toBe('wss://api.example.com/v1/ws');
    expect(socketUrl('http://10.0.2.2:3000')).toBe('ws://10.0.2.2:3000/v1/ws');
  });

  it('backs off exponentially up to 30 s', () => {
    expect(backoffMs(0, () => 1)).toBe(1000);
    expect(backoffMs(3, () => 1)).toBe(8000);
    expect(backoffMs(10, () => 1)).toBe(30_000);
    expect(backoffMs(10, () => 0)).toBe(15_000);
  });
});
