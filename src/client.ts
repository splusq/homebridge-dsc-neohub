import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import {
  parseServerMessage,
  type ArmCommand,
  type ClientMessage,
  type FullStateMessage,
  type PartitionUpdateMessage,
  type ZoneUpdateMessage,
} from './protocol.ts';

export interface ClientOptions {
  url: string;
  /** Interval between heartbeat pings; the socket is dropped if a pong is missed. */
  heartbeatMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface ClientLogger {
  info(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
}

export interface NeoHubClientEvents {
  connected: [];
  disconnected: [];
  full_state: [FullStateMessage];
  partition_update: [PartitionUpdateMessage];
  zone_update: [ZoneUpdateMessage];
  command_error: [string];
}

/**
 * Persistent connection to NeoHub's WebSocket API.
 * Reconnects with exponential backoff and re-requests full state on every connect.
 */
export class NeoHubClient extends EventEmitter<NeoHubClientEvents> {
  private readonly url: string;
  private readonly heartbeatMs: number;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly log: ClientLogger;

  private socket?: WebSocket;
  private backoffMs: number;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private awaitingPong = false;
  private stopped = false;

  constructor(options: ClientOptions, log: ClientLogger) {
    super();
    this.url = options.url;
    this.heartbeatMs = options.heartbeatMs ?? 30_000;
    this.minBackoffMs = options.minBackoffMs ?? 1_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
    this.backoffMs = this.minBackoffMs;
    this.log = log;
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.teardown();
  }

  /** Sends an arm/disarm command. Returns false if not connected. */
  sendCommand(type: ArmCommand, sessionId: string, partition: number, code?: string): boolean {
    return this.send({
      type,
      session_id: sessionId,
      partition_number: partition,
      ...(code ? { code } : {}),
    });
  }

  requestFullState(): boolean {
    return this.send({ type: 'get_full_state' });
  }

  private send(message: ClientMessage): boolean {
    if (!this.connected) {
      return false;
    }
    this.socket!.send(JSON.stringify(message));
    return true;
  }

  private connect(): void {
    this.log.debug(`Connecting to ${this.url}`);
    const socket = new WebSocket(this.url, { handshakeTimeout: 10_000 });
    this.socket = socket;

    socket.on('open', () => {
      this.log.info(`Connected to NeoHub at ${this.url}`);
      this.backoffMs = this.minBackoffMs;
      this.startHeartbeat();
      this.emit('connected');
      this.requestFullState();
    });

    socket.on('message', (data) => this.handleMessage(data.toString()));

    socket.on('pong', () => {
      this.awaitingPong = false;
    });

    socket.on('error', (err: NodeJS.ErrnoException) => {
      // Connection refused arrives as an AggregateError with an empty message.
      this.log.debug(`NeoHub socket error: ${err.message || err.code || err.name}`);
    });

    socket.on('close', () => {
      const wasOpen = this.heartbeatTimer !== undefined;
      this.teardown();
      if (wasOpen) {
        this.log.warn('Disconnected from NeoHub');
        this.emit('disconnected');
      }
      this.scheduleReconnect();
    });
  }

  private handleMessage(raw: string): void {
    const message = parseServerMessage(raw);
    if (!message) {
      this.log.debug(`Ignoring unrecognised message: ${raw.slice(0, 200)}`);
      return;
    }
    switch (message.type) {
      case 'full_state':
        this.emit('full_state', message);
        break;
      case 'partition_update':
        this.emit('partition_update', message);
        break;
      case 'zone_update':
        this.emit('zone_update', message);
        break;
      case 'error':
        this.emit('command_error', message.message);
        break;
    }
  }

  private startHeartbeat(): void {
    this.awaitingPong = false;
    this.heartbeatTimer = setInterval(() => {
      if (this.awaitingPong) {
        this.log.warn('NeoHub heartbeat missed, dropping connection');
        this.socket?.terminate();
        return;
      }
      this.awaitingPong = true;
      this.socket?.ping();
    }, this.heartbeatMs);
  }

  private teardown(): void {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    // Keep a no-op error handler: a late 'error' with no listener would crash Homebridge.
    this.socket?.removeAllListeners().on('error', () => {});
    this.socket = undefined;
  }

  private scheduleReconnect(): void {
    if (this.stopped) {
      return;
    }
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    this.log.debug(`Reconnecting in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
