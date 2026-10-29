import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfig } from '../src/settings.ts';

const zones = (raw: unknown[]) => {
  const warnings: string[] = [];
  const config = parseConfig({ zones: raw }, (msg) => warnings.push(msg));
  return { zones: config.zones, warnings };
};

test('zones without a type, or with "auto", take the type from NeoHub', () => {
  const { zones: parsed, warnings } = zones([{ zone: 1, name: 'Hall' }, { zone: 2, type: 'auto' }]);
  assert.deepEqual(parsed.get(1), { zone: 1, name: 'Hall', type: undefined });
  assert.deepEqual(parsed.get(2), { zone: 2, name: undefined, type: undefined });
  assert.deepEqual(warnings, []);
});

test('an explicit zone type is kept', () => {
  const { zones: parsed } = zones([{ zone: 3, type: 'motion' }, { zone: 4, type: 'hidden' }]);
  assert.equal(parsed.get(3)?.type, 'motion');
  assert.equal(parsed.get(4)?.type, 'hidden');
});

test('invalid zone entries are dropped with a warning', () => {
  const { zones: parsed, warnings } = zones([{ zone: 0 }, { zone: 5, type: 'glass' }]);
  assert.equal(parsed.size, 0);
  assert.equal(warnings.length, 2);
});
