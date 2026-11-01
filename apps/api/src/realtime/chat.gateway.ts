import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  HttpException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { CHAT_RULES, clientFrameSchema, type ServerFrame } from '@activity/shared';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { TokenAuthenticator } from '../auth/token-authenticator.js';
import type { AuthUser } from '../auth/decorators.js';
import { ChatService } from '../chat/chat.service.js';
import type { Env } from '../config/env.js';
import { RealtimeService, type Connection } from './realtime.service.js';

export const WS_PATH = '/v1/ws';

/** Close codes the app understands. */
export const WS_CLOSE = {
  unauthorized: 4401,
  authTimeout: 4408,
  badFrame: 4400,
  /** Server shutting down (deploy): reconnect right away. */
  restart: 1012,
} as const;

/**
 * Chat over WebSocket at `/v1/ws`, on the same port and ALB as the REST API.
 *
 * The client authenticates with its first frame (`{type:"auth", token}`) rather
 * than a query string, so access tokens never land in ALB access logs. Sends
 * go through ChatService, the same path as `POST /v1/chats/:id/messages`, so
 * rules and idempotency are identical. Sockets are stateless beyond the
 * member id: any task can serve any member, a deploy just makes clients
 * reconnect and catch up with `GET messages?after=<last id>`.
 */
@Injectable()
export class ChatGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ChatGateway.name);
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  private server: Server | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly alive = new WeakMap<WebSocket, boolean>();
  private readonly allowedOrigins: string[];

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly tokens: TokenAuthenticator,
    private readonly chat: ChatService,
    private readonly realtime: RealtimeService,
    config: ConfigService<Env, true>,
  ) {
    this.allowedOrigins = config
      .get('CORS_ORIGINS', { infer: true })
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  onApplicationBootstrap(): void {
    this.server = this.adapterHost.httpAdapter.getHttpServer() as Server;
    this.server.on('upgrade', this.onUpgrade);
    this.heartbeat = setInterval(() => this.beat(), CHAT_RULES.heartbeatMs);
    this.heartbeat.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.server?.off('upgrade', this.onUpgrade);
    for (const ws of this.wss.clients) ws.close(WS_CLOSE.restart, 'Server restarting');
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  private readonly onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== WS_PATH) return; // not ours; leave it for anything else listening
    // Native apps send no Origin. A browser page may only connect from an allowed origin.
    const origin = req.headers.origin;
    if (origin && !this.allowedOrigins.includes(origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
  };

  private onConnection(ws: WebSocket) {
    let conn: Connection | null = null;
    this.alive.set(ws, true);
    ws.on('pong', () => {
      this.alive.set(ws, true);
      if (conn) void this.realtime.touch(conn);
    });

    const authTimer = setTimeout(() => {
      if (!conn) ws.close(WS_CLOSE.authTimeout, 'Authenticate first');
    }, CHAT_RULES.authTimeoutMs);

    const send = (frame: ServerFrame) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
    };

    // Frames are handled one at a time per socket so acks keep the client's order.
    let queue = Promise.resolve();
    ws.on('message', (data: RawData, isBinary: boolean) => {
      queue = queue.then(async () => {
        if (isBinary) return ws.close(WS_CLOSE.badFrame, 'Text frames only');
        let parsed: unknown;
        try {
          parsed = JSON.parse(data.toString());
        } catch {
          return ws.close(WS_CLOSE.badFrame, 'Invalid JSON');
        }
        const frame = clientFrameSchema.safeParse(parsed);
        if (!frame.success) {
          return send({ type: 'error', code: 'invalid_frame', message: 'Unrecognised frame' });
        }
        const f = frame.data;

        if (f.type === 'ping') return send({ type: 'pong' });
        if (f.type === 'auth') {
          if (conn) return; // already authenticated; ignore
          let user: AuthUser;
          try {
            user = await this.tokens.authenticate(f.token);
          } catch (err) {
            clearTimeout(authTimer);
            const message = err instanceof HttpException ? err.message : 'Sign in again';
            return ws.close(WS_CLOSE.unauthorized, message.slice(0, 120));
          }
          clearTimeout(authTimer);
          if (ws.readyState !== WebSocket.OPEN) return;
          conn = { id: randomUUID(), userId: user.id, send };
          this.realtime.register(conn);
          return send({ type: 'ready', userId: user.id });
        }
        if (!conn) return ws.close(WS_CLOSE.unauthorized, 'Authenticate first');

        try {
          if (f.type === 'send') {
            const message = await this.chat.send(conn.userId, f.chatId, {
              clientId: f.clientId,
              body: f.body,
            });
            send({ type: 'ack', clientId: f.clientId, message });
          } else if (f.type === 'read') {
            await this.chat.markRead(conn.userId, f.chatId, f.messageId);
          }
        } catch (err) {
          const body =
            err instanceof HttpException
              ? (err.getResponse() as { code?: string; message?: string })
              : { code: 'internal_error', message: 'Something went wrong' };
          if (!(err instanceof HttpException)) {
            this.logger.error(`Frame ${f.type} failed: ${(err as Error).message}`);
          }
          send({
            type: 'error',
            code: body.code ?? 'error',
            message: body.message ?? 'Something went wrong',
            ...(f.type === 'send' ? { clientId: f.clientId } : {}),
          });
        }
      });
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (conn) this.realtime.unregister(conn);
    });
    ws.on('error', (err) => this.logger.debug(`Socket error: ${err.message}`));
  }

  /** Drops sockets that missed a ping (dead mobile connections) and pings the rest. */
  private beat() {
    for (const ws of this.wss.clients) {
      if (this.alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      this.alive.set(ws, false);
      ws.ping();
    }
  }
}
