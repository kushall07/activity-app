import {
  serverFrameSchema,
  type ClientFrame,
  type Message,
  type ServerFrame,
} from '@activity/shared';

export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'offline';

type SocketLike = Pick<WebSocket, 'send' | 'close' | 'readyState'> & {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
};

export interface RealtimeOptions {
  url: string;
  /** Access token for the auth frame; `force` asks for a refreshed one after a 4401. */
  getToken: (force: boolean) => Promise<string | null>;
  onFrame: (frame: ServerFrame) => void;
  onStatus?: (status: RealtimeStatus) => void;
  /** Called after every successful (re)connect, so the app can fetch what it missed. */
  onReady?: () => void;
  createSocket?: (url: string) => SocketLike;
  /** Overridable for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

const OPEN = 1;
const UNAUTHORIZED = 4401;
const ACK_TIMEOUT_MS = 10_000;

/** http(s)://host -> ws(s)://host/v1/ws */
export function socketUrl(apiUrl: string): string {
  return `${apiUrl.replace(/^http/, 'ws')}/v1/ws`;
}

/** 1 s, 2 s, 4 s ... capped at 30 s, with jitter so a deploy does not cause a reconnect stampede. */
export function backoffMs(attempt: number, random = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  return Math.round(base / 2 + random() * (base / 2));
}

/**
 * The chat socket: authenticates with its first frame, reconnects with
 * backoff, and resolves sends when the server acks them by clientId.
 * Anything missed while offline is fetched over REST in `onReady`.
 */
export class RealtimeClient {
  private socket: SocketLike | null = null;
  private attempt = 0;
  private retryTimer: unknown = null;
  private stopped = true;
  private ready = false;
  private forceRefresh = false;
  private readonly pending = new Map<
    string,
    { resolve: (m: Message) => void; reject: (e: Error) => void; timer: unknown }
  >();

  constructor(private readonly opts: RealtimeOptions) {}

  get connected(): boolean {
    return this.ready && this.socket?.readyState === OPEN;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clear(this.retryTimer);
    this.retryTimer = null;
    this.socket?.close();
    this.socket = null;
    this.setReady(false, 'idle');
    for (const [id, p] of this.pending) {
      this.clear(p.timer);
      p.reject(new Error('Disconnected'));
      this.pending.delete(id);
    }
  }

  /** Reconnect now (e.g. the app came back to the foreground). */
  poke(): void {
    if (this.stopped || this.connected) return;
    this.clear(this.retryTimer);
    this.retryTimer = null;
    this.attempt = 0;
    void this.connect();
  }

  /** Sends a chat message; resolves with the stored message once the server acks it. */
  sendMessage(chatId: string, clientId: string, body: string): Promise<Message> {
    if (!this.connected) return Promise.reject(new Error('Not connected'));
    return new Promise<Message>((resolve, reject) => {
      const timer = this.timer(() => {
        this.pending.delete(clientId);
        reject(new Error('No reply from the server'));
      }, ACK_TIMEOUT_MS);
      this.pending.set(clientId, { resolve, reject, timer });
      this.raw({ type: 'send', chatId, clientId, body });
    });
  }

  markRead(chatId: string, messageId: number): boolean {
    if (!this.connected) return false;
    this.raw({ type: 'read', chatId, messageId });
    return true;
  }

  private raw(frame: ClientFrame) {
    this.socket?.send(JSON.stringify(frame));
  }

  private async connect() {
    if (this.stopped) return;
    this.opts.onStatus?.('connecting');
    const token = await this.opts.getToken(this.forceRefresh).catch(() => null);
    this.forceRefresh = false;
    if (this.stopped) return;
    if (!token) return this.scheduleRetry();

    const ws = (this.opts.createSocket ?? ((u) => new WebSocket(u) as unknown as SocketLike))(
      this.opts.url,
    );
    this.socket = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
    ws.onmessage = (ev) => this.onMessage(ev.data);
    ws.onerror = () => undefined; // onclose follows and handles the retry
    ws.onclose = (ev) => {
      if (this.socket !== ws) return;
      this.socket = null;
      this.setReady(false, this.stopped ? 'idle' : 'offline');
      for (const [id, p] of this.pending) {
        this.clear(p.timer);
        p.reject(new Error('Connection lost'));
        this.pending.delete(id);
      }
      if (ev.code === UNAUTHORIZED) this.forceRefresh = true;
      this.scheduleRetry();
    };
  }

  private onMessage(data: unknown) {
    let frame: ServerFrame;
    try {
      frame = serverFrameSchema.parse(JSON.parse(String(data)));
    } catch {
      return;
    }
    if (frame.type === 'ready') {
      this.attempt = 0;
      this.setReady(true, 'connected');
      this.opts.onReady?.();
      return;
    }
    if (frame.type === 'ack') {
      const p = this.pending.get(frame.clientId);
      if (p) {
        this.clear(p.timer);
        this.pending.delete(frame.clientId);
        p.resolve(frame.message);
      }
    }
    if (frame.type === 'error' && frame.clientId) {
      const p = this.pending.get(frame.clientId);
      if (p) {
        this.clear(p.timer);
        this.pending.delete(frame.clientId);
        p.reject(new Error(frame.message));
      }
    }
    this.opts.onFrame(frame);
  }

  private scheduleRetry() {
    if (this.stopped) return;
    const delay = backoffMs(this.attempt++);
    this.retryTimer = this.timer(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  private setReady(ready: boolean, status: RealtimeStatus) {
    this.ready = ready;
    this.opts.onStatus?.(status);
  }

  private timer(fn: () => void, ms: number) {
    return (this.opts.setTimer ?? setTimeout)(fn, ms);
  }

  private clear(t: unknown) {
    if (t != null) (this.opts.clearTimer ?? ((x) => clearTimeout(x as number)))(t);
  }
}
