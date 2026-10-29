import type { ArmCommand, PartitionStatus } from './protocol.ts';

// HAP SecuritySystemCurrentState / SecuritySystemTargetState values.
// Fixed by the HomeKit spec, so they're safe to use without the hap object.
export const CURRENT = {
  STAY_ARM: 0,
  AWAY_ARM: 1,
  NIGHT_ARM: 2,
  DISARMED: 3,
  ALARM_TRIGGERED: 4,
} as const;

export const TARGET = {
  STAY_ARM: 0,
  AWAY_ARM: 1,
  NIGHT_ARM: 2,
  DISARM: 3,
} as const;

export type CurrentState = (typeof CURRENT)[keyof typeof CURRENT];
export type TargetState = (typeof TARGET)[keyof typeof TARGET];

export interface SecurityState {
  current: CurrentState;
  target: TargetState;
  /** Last armed mode seen, used to hold "armed" through an entry delay. */
  lastArmed?: CurrentState;
  /** Target requested from HomeKit that the panel hasn't reached yet. */
  requested?: TargetState;
}

export const INITIAL_STATE: SecurityState = {
  current: CURRENT.DISARMED,
  target: TARGET.DISARM,
};

const ARMED: Partial<Record<PartitionStatus, CurrentState>> = {
  armed_home: CURRENT.STAY_ARM,
  armed_away: CURRENT.AWAY_ARM,
  armed_night: CURRENT.NIGHT_ARM,
};

/** Target state that matches an armed (or disarmed) current state. */
function targetFor(current: CurrentState): TargetState {
  return current === CURRENT.ALARM_TRIGGERED ? TARGET.DISARM : (current as TargetState);
}

/**
 * Applies a NeoHub partition status to the HomeKit security state.
 *
 * HomeKit has no exit/entry delay states, so:
 * - `arming` (exit delay) keeps current as-is and sets target to the requested
 *   mode (or Away when armed from the keypad), which HomeKit shows as "Arming...".
 * - `pending` (entry delay) holds the last armed mode until disarm or alarm.
 * - `unknown` leaves the state unchanged.
 */
export function applyStatus(state: SecurityState, status: PartitionStatus): SecurityState {
  const armed = ARMED[status];
  if (armed !== undefined) {
    return { current: armed, target: targetFor(armed), lastArmed: armed };
  }
  switch (status) {
    case 'disarmed':
      return { current: CURRENT.DISARMED, target: TARGET.DISARM };
    case 'triggered':
      return { ...state, current: CURRENT.ALARM_TRIGGERED };
    case 'arming':
      return { ...state, target: state.requested ?? TARGET.AWAY_ARM };
    case 'pending': {
      const current = state.lastArmed ?? CURRENT.AWAY_ARM;
      return { ...state, current, target: targetFor(current) };
    }
    default:
      return state;
  }
}

/** Records a HomeKit target request before it's sent to the panel. */
export function applyRequest(state: SecurityState, target: TargetState): SecurityState {
  return { ...state, target, requested: target };
}

/** Rolls back an unfulfilled request, e.g. after the panel rejected it. */
export function revertRequest(state: SecurityState): SecurityState {
  const { requested: _requested, ...rest } = state;
  return { ...rest, target: targetFor(state.current) };
}

const COMMANDS: Record<TargetState, ArmCommand> = {
  [TARGET.STAY_ARM]: 'arm_home',
  [TARGET.AWAY_ARM]: 'arm_away',
  [TARGET.NIGHT_ARM]: 'arm_night',
  [TARGET.DISARM]: 'disarm',
};

export function commandFor(target: TargetState): ArmCommand {
  return COMMANDS[target];
}

export const ZONE_TYPES = ['contact', 'motion', 'smoke', 'leak', 'co', 'hidden'] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

export function isZoneType(value: unknown): value is ZoneType {
  return typeof value === 'string' && (ZONE_TYPES as readonly string[]).includes(value);
}

// NeoHub reports Home Assistant binary_sensor device classes, derived from the
// panel's zone definitions when it has the installer code (otherwise "door").
const DEVICE_CLASS_TYPES = new Map<string, Exclude<ZoneType, 'hidden'>>([
  ['motion', 'motion'],
  ['smoke', 'smoke'],
  ['heat', 'smoke'],
  ['carbon_monoxide', 'co'],
  ['gas', 'co'],
  ['moisture', 'leak'],
]);

/** Sensor type for a NeoHub device class; classes HomeKit has no sensor for are contact sensors. */
export function zoneTypeFor(deviceClass: string | undefined): Exclude<ZoneType, 'hidden'> {
  return DEVICE_CLASS_TYPES.get(deviceClass ?? '') ?? 'contact';
}
