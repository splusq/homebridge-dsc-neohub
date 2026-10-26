import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { NeoHubClient } from '../src/client.ts';
import { MockNeoHub } from './mock-neohub.ts';

const quiet = { info() {}, warn() {}, debug() {} };
let hub: MockNeoHub;
let client: NeoHubClient;

before(async () => {
  hub = new MockNeoHub({ exitDelayMs: 50 });
  await once(hub.wss, 'listening');
  client = new NeoHubClient(
    { url: `ws://localhost:${hub.port}/api/ws`, minBackoffMs: 50, maxBackoffMs: 100, heartbeatMs: 100 },
    quiet,
  );
});

after(async () => {
  client.stop();
  await hub.close();
});

test('connects and receives full state', async () => {
  const fullState = once(client, 'full_state');
  client.start();
  const [msg] = await fullState;
  assert.equal(msg.sessions[0].session_id, 'MOCK123');
  assert.equal(msg.sessions[0].zones.length, 4);
  assert.equal(client.connected, true);
});

test('receives zone updates', async () => {
  const update = once(client, 'zone_update');
  hub.setZone(2, true);
  const [msg] = await update;
  assert.deepEqual(msg, { type: 'zone_update', session_id: 'MOCK123', zone_number: 2, open: true, bypassed: false });
});

test('arm command goes through arming to armed', async () => {
  const statuses: string[] = [];
  const done = new Promise<void>((resolve) => {
    const onUpdate = (m: { status: string }) => {
      statuses.push(m.status);
      if (m.status === 'armed_home') {
        client.off('partition_update', onUpdate);
        resolve();
      }
    };
    client.on('partition_update', onUpdate);
  });
  assert.equal(client.sendCommand('arm_home', 'MOCK123', 1, '1234'), true);
  await done;
  assert.deepEqual(statuses, ['arming', 'armed_home']);
  assert.deepEqual(hub.received.at(-1), { type: 'arm_home', session_id: 'MOCK123', partition_number: 1, code: '1234' });
});

test('bad code surfaces as command_error', async () => {
  const error = once(client, 'command_error');
  client.sendCommand('disarm', 'MOCK123', 1, '0000');
  const [message] = await error;
  assert.equal(message, 'Invalid access code');
});

test('omits code when none configured', async () => {
  const error = once(client, 'command_error');
  client.sendCommand('disarm', 'MOCK123', 1);
  await error;
  assert.equal('code' in hub.received.at(-1)!, false);
});

test('reconnects and re-requests full state after NeoHub drops', async () => {
  const disconnected = once(client, 'disconnected');
  const resynced = once(client, 'full_state');
  hub.dropClients();
  await disconnected;
  assert.equal(client.connected, false);
  assert.equal(client.sendCommand('arm_away', 'MOCK123', 1), false);
  await resynced;
  assert.equal(client.connected, true);
});
