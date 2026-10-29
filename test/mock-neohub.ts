// A stand-in for NeoHub's /api/ws endpoint, for tests and manual runs.
// Usage: node test/mock-neohub.ts [port]   then type commands on stdin (see HELP).

import { createInterface } from 'node:readline';
import { WebSocketServer, type WebSocket } from 'ws';
import type { PartitionStatus, SessionDto } from '../src/protocol.ts';

export interface MockOptions {
  port?: number;
  validCodes?: string[];
  /** Default code used when a command carries none (NeoHub's DefaultAccessCode). */
  defaultCode?: string;
  exitDelayMs?: number;
}

export function demoSession(): SessionDto {
  return {
    session_id: 'MOCK123',
    name: 'MOCK123',
    partitions: [{ partition_number: 1, name: 'Partition 1', status: 'disarmed' }],
    zones: [
      { zone_number: 1, name: 'Front Door', device_class: 'door', open: false, bypassed: false, partitions: [1] },
      { zone_number: 2, name: 'Back Door', device_class: 'door', open: false, bypassed: false, partitions: [1] },
      { zone_number: 3, name: 'Hall Motion', device_class: 'motion', open: false, bypassed: false, partitions: [1] },
      { zone_number: 4, name: 'Basement Window', device_class: 'door', open: false, bypassed: true, partitions: [1] },
    ],
  };
}

export class MockNeoHub {
  readonly wss: WebSocketServer;
  readonly received: Record<string, unknown>[] = [];
  sessions: SessionDto[] = [demoSession()];
  private readonly validCodes: Set<string>;
  private readonly defaultCode?: string;
  private readonly exitDelayMs: number;
  private timers: NodeJS.Timeout[] = [];

  constructor(options: MockOptions = {}) {
    this.validCodes = new Set(options.validCodes ?? ['1234']);
    this.defaultCode = options.defaultCode;
    this.exitDelayMs = options.exitDelayMs ?? 200;
    this.wss = new WebSocketServer({ port: options.port ?? 0, path: '/api/ws' });
    this.wss.on('connection', (ws) => {
      ws.on('message', (data) => this.handle(ws, data.toString()));
    });
  }

  get port(): number {
    const address = this.wss.address();
    return typeof address === 'object' && address ? address.port : 0;
  }

  get clientCount(): number {
    return this.wss.clients.size;
  }

  async close(): Promise<void> {
    this.timers.forEach(clearTimeout);
    for (const client of this.wss.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  /** Forcefully drops every client, as a NeoHub restart would. */
  dropClients(): void {
    for (const client of this.wss.clients) {
      client.terminate();
    }
  }

  setZone(zone: number, open: boolean, bypassed?: boolean): void {
    const session = this.sessions[0];
    const z = session.zones.find((x) => x.zone_number === zone);
    if (!z) {
      return;
    }
    z.open = open;
    if (bypassed !== undefined) {
      z.bypassed = bypassed;
    }
    this.broadcast({ type: 'zone_update', session_id: session.session_id, zone_number: zone, open: z.open, bypassed: z.bypassed });
  }

  setPartition(status: PartitionStatus, partition = 1): void {
    const session = this.sessions[0];
    const p = session.partitions.find((x) => x.partition_number === partition);
    if (!p) {
      return;
    }
    p.status = status;
    this.broadcast({ type: 'partition_update', session_id: session.session_id, partition_number: partition, status });
  }

  /** Simulates the panel connecting/disconnecting from NeoHub. */
  setPanelConnected(connected: boolean): void {
    this.sessions = connected ? [demoSession()] : [];
    this.broadcast({ type: 'full_state', sessions: this.sessions });
  }

  private handle(ws: WebSocket, raw: string): void {
    const msg = JSON.parse(raw) as Record<string, unknown>;
    this.received.push(msg);
    const send = (m: object) => ws.send(JSON.stringify(m));

    if (msg.type === 'get_full_state') {
      send({ type: 'full_state', sessions: this.sessions });
      return;
    }

    const modes: Record<string, PartitionStatus> = {
      arm_away: 'armed_away',
      arm_home: 'armed_home',
      arm_night: 'armed_night',
    };
    const code = (msg.code as string | undefined) ?? this.defaultCode;

    if (msg.type === 'disarm') {
      if (!code) {
        send({ type: 'error', message: 'Access code is required to disarm' });
      } else if (!this.validCodes.has(code)) {
        send({ type: 'error', message: 'Invalid access code' });
      } else {
        this.setPartition('disarmed', msg.partition_number as number);
      }
      return;
    }

    const armed = modes[msg.type as string];
    if (armed) {
      if (code && !this.validCodes.has(code)) {
        send({ type: 'error', message: 'Invalid access code' });
        return;
      }
      const partition = msg.partition_number as number;
      this.setPartition('arming', partition);
      this.timers.push(setTimeout(() => this.setPartition(armed, partition), this.exitDelayMs));
      return;
    }

    send({ type: 'error', message: `Unknown message type: ${String(msg.type)}` });
  }

  private broadcast(message: object): void {
    const json = JSON.stringify(message);
    for (const client of this.wss.clients) {
      client.send(json);
    }
  }
}

const HELP = `Commands:
  open <zone> | close <zone> | bypass <zone> | unbypass <zone>
  status <disarmed|armed_away|armed_home|armed_night|arming|pending|triggered>
  panel <on|off>     simulate the panel connecting/disconnecting from NeoHub
  drop               drop all WebSocket clients
  state              print current state`;

if (import.meta.main) {
  const port = Number(process.argv[2]) || 8090;
  const hub = new MockNeoHub({ port, exitDelayMs: 5000, defaultCode: '1234' });
  console.log(`Mock NeoHub on ws://localhost:${port}/api/ws (valid code 1234, 5s exit delay)\n${HELP}`);
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const [cmd, arg] = line.trim().split(/\s+/);
    const zone = Number(arg);
    const session = hub.sessions[0];
    const current = session?.zones.find((z) => z.zone_number === zone);
    switch (cmd) {
      case 'open': hub.setZone(zone, true); break;
      case 'close': hub.setZone(zone, false); break;
      case 'bypass': hub.setZone(zone, current?.open ?? false, true); break;
      case 'unbypass': hub.setZone(zone, current?.open ?? false, false); break;
      case 'status': hub.setPartition(arg as PartitionStatus); break;
      case 'panel': hub.setPanelConnected(arg !== 'off'); break;
      case 'drop': hub.dropClients(); break;
      case 'state': console.log(JSON.stringify(hub.sessions, null, 2)); break;
      default: console.log(HELP);
    }
  });
}
