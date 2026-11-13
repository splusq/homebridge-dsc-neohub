import type {
  API,
  DynamicPlatformPlugin,
  HapStatusError,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';
import { NeoHubClient } from './client.ts';
import { zoneTypeFor, type ZoneType } from './mapping.ts';
import { PartitionAccessory, type PartitionContext } from './partitionAccessory.ts';
import type { FullStateMessage, SessionDto } from './protocol.ts';
import { PLATFORM_NAME, PLUGIN_NAME, parseConfig, type PluginConfig } from './settings.ts';
import { ZoneAccessory, type ZoneContext } from './zoneAccessory.ts';

type Context = PartitionContext | ZoneContext;
type Handler = PartitionAccessory | ZoneAccessory;

export class NeoHubPlatform implements DynamicPlatformPlugin {
  readonly log: Logging;
  readonly api: API;
  readonly config: PluginConfig;
  readonly client: NeoHubClient;

  private readonly cached = new Map<string, PlatformAccessory<Context>>();
  private readonly handlers = new Map<string, Handler>();
  private lastCommand?: PartitionAccessory;

  constructor(log: Logging, rawConfig: PlatformConfig, api: API) {
    this.log = log;
    this.api = api;
    this.config = parseConfig(rawConfig, (msg) => log.warn(msg));

    const url = `ws://${this.config.host}:${this.config.port}/api/ws`;
    this.client = new NeoHubClient({ url }, log);
    this.client.on('connected', () => this.handleConnected());
    this.client.on('disconnected', () => this.setAllAvailable(false));
    this.client.on('full_state', (msg) => this.handleFullState(msg));
    this.client.on('partition_update', (msg) =>
      this.partitionHandler(msg.session_id, msg.partition_number)?.updateStatus(msg.status),
    );
    this.client.on('zone_update', (msg) =>
      this.zoneHandler(msg.session_id, msg.zone_number)?.update(msg.open, msg.bypassed),
    );
    this.client.on('command_error', (message) => this.handleCommandError(message));

    api.on('didFinishLaunching', () => {
      // Cached accessories get handlers right away so they report "No Response"
      // rather than stale state until NeoHub confirms them.
      for (const accessory of this.cached.values()) {
        this.attach(accessory);
      }
      this.client.start();
    });
    api.on('shutdown', () => this.client.stop());
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.cached.set(accessory.UUID, accessory as PlatformAccessory<Context>);
  }

  /** Thrown from handlers so HomeKit shows "No Response". */
  communicationFailure(): HapStatusError {
    // HAPStatus.SERVICE_COMMUNICATION_FAILURE; it's an ambient const enum, so use the value.
    return new this.api.hap.HapStatusError(-70402);
  }

  /** NeoHub errors aren't tied to a request, so attribute them to the latest command. */
  trackCommand(handler: PartitionAccessory): void {
    this.lastCommand = handler;
  }

  private handleConnected(): void {
    if (!this.config.userCode) {
      this.log.debug('No userCode configured; NeoHub will use its default access code');
    }
  }

  private handleCommandError(message: string): void {
    if (this.lastCommand?.hasPendingRequest) {
      this.lastCommand.rejectRequest(message);
    } else {
      this.log.warn(`NeoHub error: ${message}`);
    }
  }

  private handleFullState(message: FullStateMessage): void {
    const live = new Set<string>();
    for (const session of message.sessions) {
      for (const uuid of this.syncSession(session)) {
        live.add(uuid);
      }
    }
    if (message.sessions.length === 0) {
      this.log.info('NeoHub is up but no panel is connected yet');
    }
    // Accessories NeoHub no longer reports stay registered (keeping HomeKit
    // automations intact) but show "No Response".
    for (const [uuid, handler] of this.handlers) {
      handler.setAvailable(live.has(uuid));
    }
  }

  /** Registers/updates accessories for one panel session; returns the live UUIDs. */
  private syncSession(session: SessionDto): string[] {
    const live: string[] = [];
    const sessionId = session.session_id;

    for (const p of session.partitions) {
      const name = this.config.partitions.get(p.partition_number)?.name ?? p.name ?? `Partition ${p.partition_number}`;
      const handler = this.ensure({ kind: 'partition', sessionId, partition: p.partition_number }, name);
      if (handler instanceof PartitionAccessory) {
        handler.setAvailable(true);
        handler.updateStatus(p.status);
        live.push(handler.accessory.UUID);
      }
    }

    for (const z of session.zones) {
      const zoneConfig = this.config.zones.get(z.zone_number);
      const configured = zoneConfig?.type;
      const detected = zoneTypeFor(z.device_class);
      const uuid = this.uuid({ kind: 'zone', sessionId, zone: z.zone_number, type: configured ?? detected });
      if (configured === 'hidden') {
        this.remove(uuid);
        continue;
      }
      const name = zoneConfig?.name ?? z.name ?? `Zone ${z.zone_number}`;
      const handler = this.ensure({ kind: 'zone', sessionId, zone: z.zone_number, type: configured ?? detected }, name);
      if (handler instanceof ZoneAccessory) {
        const type = zoneTypeToApply(handler.accessory.context.type, configured);
        if (type !== handler.accessory.context.type) {
          this.log.info(`${handler.accessory.displayName}: type ${handler.accessory.context.type} -> ${type}`);
          handler.setType(type);
          this.api.updatePlatformAccessories([handler.accessory]);
        } else if (!configured && detected !== handler.accessory.context.type) {
          this.log.debug(
            `${handler.accessory.displayName}: NeoHub reports ${detected}, keeping ${handler.accessory.context.type}`,
          );
        }
        handler.setAvailable(true);
        handler.update(z.open, z.bypassed);
        live.push(uuid);
      }
    }
    return live;
  }

  private ensure(context: Context, name: string): Handler {
    const uuid = this.uuid(context);
    const existing = this.handlers.get(uuid);
    if (existing) {
      return existing;
    }
    const accessory = new this.api.platformAccessory<Context>(name, uuid);
    accessory.context = context;
    const handler = this.attach(accessory);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.log.info(`Added ${context.kind} "${name}"`);
    return handler;
  }

  private attach(accessory: PlatformAccessory<Context>): Handler {
    const handler =
      accessory.context.kind === 'partition'
        ? new PartitionAccessory(this, accessory as PlatformAccessory<PartitionContext>)
        : new ZoneAccessory(this, accessory as PlatformAccessory<ZoneContext>);
    this.handlers.set(accessory.UUID, handler);
    return handler;
  }

  private remove(uuid: string): void {
    const handler = this.handlers.get(uuid);
    if (handler) {
      this.handlers.delete(uuid);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [handler.accessory]);
      this.log.info(`Removed hidden zone "${handler.accessory.displayName}"`);
    }
  }

  private setAllAvailable(available: boolean): void {
    for (const handler of this.handlers.values()) {
      handler.setAvailable(available);
    }
  }

  private partitionHandler(sessionId: string, partition: number): PartitionAccessory | undefined {
    const handler = this.handlers.get(this.uuid({ kind: 'partition', sessionId, partition }));
    return handler instanceof PartitionAccessory ? handler : undefined;
  }

  private zoneHandler(sessionId: string, zone: number): ZoneAccessory | undefined {
    const handler = this.handlers.get(this.uuid({ kind: 'zone', sessionId, zone, type: 'contact' }));
    return handler instanceof ZoneAccessory ? handler : undefined;
  }

  private uuid(context: Context): string {
    return this.api.hap.uuid.generate(accessorySeed(context));
  }
}

/**
 * The seed for an accessory's UUID. Stable per panel session + partition/zone, and deliberately
 * excludes zone type and name. Changing it makes HomeKit see every accessory as new, which loses
 * their names, rooms and automations, so test/platform.test.ts pins it to known values.
 */
export function accessorySeed(context: Context): string {
  const id = context.kind === 'partition' ? `P${context.partition}` : `Z${context.zone}`;
  return `${PLUGIN_NAME}:${context.sessionId}:${id}`;
}

/**
 * The type an existing zone accessory should have. Only an explicit config type changes it:
 * a changed type swaps the HomeKit service and breaks automations that used it, and NeoHub
 * reports every zone as "door" until it has read the panel's zone definitions, so the
 * detected type only applies when the accessory is first created.
 */
export function zoneTypeToApply(
  current: ZoneType,
  configured: ZoneType | undefined,
): Exclude<ZoneType, 'hidden'> {
  // Registered zone accessories are never "hidden"; hidden zones are unregistered instead.
  return configured && configured !== 'hidden' ? configured : (current as Exclude<ZoneType, 'hidden'>);
}
