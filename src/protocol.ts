// Message shapes for NeoHub's WebSocket API (/api/ws).
// Mirrors NeoHub/Api/WebSocket/Models/WebSocketMessage.cs; JSON is snake_case.

export type PartitionStatus =
  | 'unknown'
  | 'disarmed'
  | 'armed_away'
  | 'armed_home'
  | 'armed_night'
  | 'arming'
  | 'pending'
  | 'triggered';

export interface PartitionDto {
  partition_number: number;
  name: string;
  status: PartitionStatus;
}

export interface ZoneDto {
  zone_number: number;
  name: string;
  device_class: string;
  open: boolean;
  bypassed: boolean;
  partitions: number[];
}

export interface SessionDto {
  session_id: string;
  name: string;
  partitions: PartitionDto[];
  zones: ZoneDto[];
}

export interface FullStateMessage {
  type: 'full_state';
  sessions: SessionDto[];
}

export interface PartitionUpdateMessage {
  type: 'partition_update';
  session_id: string;
  partition_number: number;
  status: PartitionStatus;
}

export interface ZoneUpdateMessage {
  type: 'zone_update';
  session_id: string;
  zone_number: number;
  open: boolean;
  bypassed: boolean;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type ServerMessage =
  | FullStateMessage
  | PartitionUpdateMessage
  | ZoneUpdateMessage
  | ErrorMessage;

export type ArmCommand = 'arm_away' | 'arm_home' | 'arm_night' | 'disarm';

export interface ArmCommandMessage {
  type: ArmCommand;
  session_id: string;
  partition_number: number;
  code?: string;
}

export type ClientMessage = { type: 'get_full_state' } | ArmCommandMessage;

const SERVER_TYPES = new Set(['full_state', 'partition_update', 'zone_update', 'error']);

/** Parses a frame from NeoHub, returning undefined for anything unrecognised. */
export function parseServerMessage(raw: string): ServerMessage | undefined {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }
  const type = (data as { type?: unknown }).type;
  if (typeof type !== 'string' || !SERVER_TYPES.has(type)) {
    return undefined;
  }
  return data as ServerMessage;
}
