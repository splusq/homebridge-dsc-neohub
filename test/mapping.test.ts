import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CURRENT,
  INITIAL_STATE,
  TARGET,
  applyRequest,
  applyStatus,
  commandFor,
  revertRequest,
  zoneTypeFor,
  type SecurityState,
} from '../src/mapping.ts';
import type { PartitionStatus } from '../src/protocol.ts';

const run = (statuses: PartitionStatus[], start: SecurityState = INITIAL_STATE) =>
  statuses.reduce(applyStatus, start);

test('armed statuses set matching current and target', () => {
  assert.deepEqual(applyStatus(INITIAL_STATE, 'armed_away'), {
    current: CURRENT.AWAY_ARM, target: TARGET.AWAY_ARM, lastArmed: CURRENT.AWAY_ARM,
  });
  assert.equal(applyStatus(INITIAL_STATE, 'armed_home').current, CURRENT.STAY_ARM);
  assert.equal(applyStatus(INITIAL_STATE, 'armed_night').current, CURRENT.NIGHT_ARM);
});

test('disarmed clears everything', () => {
  assert.deepEqual(run(['armed_away', 'disarmed']), { current: CURRENT.DISARMED, target: TARGET.DISARM });
});

test('keypad arming (no HomeKit request) shows Arming toward Away', () => {
  const s = applyStatus(INITIAL_STATE, 'arming');
  assert.equal(s.current, CURRENT.DISARMED);
  assert.equal(s.target, TARGET.AWAY_ARM);
});

test('HomeKit arm-home request holds target through exit delay', () => {
  let s = applyRequest(INITIAL_STATE, TARGET.STAY_ARM);
  s = applyStatus(s, 'arming');
  assert.equal(s.current, CURRENT.DISARMED);
  assert.equal(s.target, TARGET.STAY_ARM);
  s = applyStatus(s, 'armed_home');
  assert.equal(s.current, CURRENT.STAY_ARM);
  assert.equal(s.requested, undefined);
});

test('entry delay keeps last armed mode', () => {
  const s = run(['armed_night', 'pending']);
  assert.equal(s.current, CURRENT.NIGHT_ARM);
  assert.equal(s.target, TARGET.NIGHT_ARM);
});

test('triggered keeps the armed target so HomeKit shows an alarm while armed', () => {
  const s = run(['armed_away', 'pending', 'triggered']);
  assert.equal(s.current, CURRENT.ALARM_TRIGGERED);
  assert.equal(s.target, TARGET.AWAY_ARM);
  assert.deepEqual(applyStatus(s, 'disarmed'), { current: CURRENT.DISARMED, target: TARGET.DISARM });
});

test('unknown leaves state untouched', () => {
  const s = run(['armed_away']);
  assert.deepEqual(applyStatus(s, 'unknown'), s);
});

test('revert puts target back to match current', () => {
  const s = revertRequest(applyRequest(run(['armed_away']), TARGET.DISARM));
  assert.equal(s.target, TARGET.AWAY_ARM);
  assert.equal(s.requested, undefined);
  // Reverting while the alarm is going off targets disarm (nothing armed to return to).
  assert.equal(revertRequest(run(['armed_away', 'triggered'])).target, TARGET.DISARM);
});

test('targets map to NeoHub commands', () => {
  assert.equal(commandFor(TARGET.STAY_ARM), 'arm_home');
  assert.equal(commandFor(TARGET.AWAY_ARM), 'arm_away');
  assert.equal(commandFor(TARGET.NIGHT_ARM), 'arm_night');
  assert.equal(commandFor(TARGET.DISARM), 'disarm');
});

test('NeoHub device classes map to HomeKit sensor types', () => {
  assert.equal(zoneTypeFor('motion'), 'motion');
  assert.equal(zoneTypeFor('smoke'), 'smoke');
  assert.equal(zoneTypeFor('heat'), 'smoke');
  assert.equal(zoneTypeFor('carbon_monoxide'), 'co');
  assert.equal(zoneTypeFor('gas'), 'co');
  assert.equal(zoneTypeFor('moisture'), 'leak');
  // No HomeKit equivalent, unknown, or an older NeoHub without the field: contact.
  for (const deviceClass of ['door', 'safety', 'tamper', 'problem', 'cold', 'constructor', '', undefined]) {
    assert.equal(zoneTypeFor(deviceClass), 'contact');
  }
});
