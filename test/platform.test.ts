import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uuid } from '@homebridge/hap-nodejs';
import { accessorySeed, zoneTypeToApply } from '../src/platform.ts';

// Real accessories from a paired install. If these change, every HomeKit accessory is seen as
// new and loses its name, room and automations, so a change here must be deliberate.
test('accessory UUIDs stay the same', () => {
  const sessionId = '200623947012';
  const generate = (seed: string) => uuid.generate(seed);
  assert.equal(generate(accessorySeed({ kind: 'partition', sessionId, partition: 1 })), 'f72efb6d-ad1d-4906-969f-62f727ed3c8a');
  assert.equal(generate(accessorySeed({ kind: 'zone', sessionId, zone: 1, type: 'motion' })), 'fb1f6def-dd20-41a0-aed9-8f57575f8441');
  assert.equal(generate(accessorySeed({ kind: 'zone', sessionId, zone: 24, type: 'contact' })), '98becc7d-7cbd-471f-a9f2-37a8ae39fa30');
});

test('zone UUIDs ignore the zone type', () => {
  const zone = { kind: 'zone', sessionId: 's', zone: 3 } as const;
  assert.equal(accessorySeed({ ...zone, type: 'motion' }), accessorySeed({ ...zone, type: 'contact' }));
});

test('an existing zone keeps its type when NeoHub reports a different one', () => {
  assert.equal(zoneTypeToApply('motion', undefined), 'motion');
  assert.equal(zoneTypeToApply('smoke', undefined), 'smoke');
});

test('an explicit config type changes an existing zone', () => {
  assert.equal(zoneTypeToApply('contact', 'motion'), 'motion');
  assert.equal(zoneTypeToApply('motion', 'motion'), 'motion');
});
