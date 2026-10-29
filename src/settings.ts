import { isZoneType, type ZoneType } from './mapping.ts';

export const PLUGIN_NAME = 'homebridge-dsc-neohub';
export const PLATFORM_NAME = 'DSCNeoHub';

export interface ZoneConfig {
  zone: number;
  name?: string;
  /** Unset means take the type from NeoHub's device class. */
  type?: ZoneType;
}

export interface PartitionConfig {
  partition: number;
  name?: string;
}

export interface PluginConfig {
  host: string;
  port: number;
  userCode?: string;
  commandTimeoutSeconds: number;
  zones: Map<number, ZoneConfig>;
  partitions: Map<number, PartitionConfig>;
}

/** Normalises raw config.json input, dropping malformed entries. */
export function parseConfig(raw: Record<string, unknown>, warn: (msg: string) => void): PluginConfig {
  const zones = new Map<number, ZoneConfig>();
  for (const entry of asArray(raw.zones)) {
    const zone = Number(entry.zone);
    const type = entry.type === 'auto' ? undefined : entry.type;
    if (!Number.isInteger(zone) || zone < 1 || (type !== undefined && !isZoneType(type))) {
      warn(`Ignoring invalid zone config: ${JSON.stringify(entry)}`);
      continue;
    }
    zones.set(zone, { zone, type, name: optionalString(entry.name) });
  }

  const partitions = new Map<number, PartitionConfig>();
  for (const entry of asArray(raw.partitions)) {
    const partition = Number(entry.partition);
    if (!Number.isInteger(partition) || partition < 1) {
      warn(`Ignoring invalid partition config: ${JSON.stringify(entry)}`);
      continue;
    }
    partitions.set(partition, { partition, name: optionalString(entry.name) });
  }

  return {
    host: optionalString(raw.host) ?? 'localhost',
    port: Number(raw.port) || 8080,
    userCode: optionalString(raw.userCode),
    commandTimeoutSeconds: Number(raw.commandTimeoutSeconds) || 15,
    zones,
    partitions,
  };
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'object' && v !== null) : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
