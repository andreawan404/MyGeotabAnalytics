import assert from 'node:assert';
import { initGeotabClient, callApi, type GeotabApi } from './geotabClient';

async function run() {
  // Scenario 1: fails twice with a transient-shaped error, then succeeds on 3rd try.
  let callCount = 0;
  initGeotabClient({
    call: (_method, _params, cb, errCb) => {
      callCount++;
      if (callCount < 3) {
        errCb?.({ name: 'ConnectionUnavailableException', message: 'timeout talking to server' });
      } else {
        cb('ok');
      }
    },
    multiCall: (_calls, cb) => cb([])
  } as GeotabApi);

  const result = await callApi('Get', { typeName: 'Trip' });
  assert.strictEqual(result, 'ok', 'expected eventual success after retries');
  assert.strictEqual(callCount, 3, 'expected exactly 3 attempts (2 retries)');

  // Scenario 2: fails once with a validation-shaped error — no retry.
  let callCount2 = 0;
  initGeotabClient({
    call: (_method, _params, _cb, errCb) => {
      callCount2++;
      errCb?.({ name: 'InvalidUserException', message: 'bad user' });
    },
    multiCall: (_calls, cb) => cb([])
  } as GeotabApi);

  await assert.rejects(() => callApi('Get', { typeName: 'Trip' }));
  assert.strictEqual(callCount2, 1, 'validation error must not be retried');

  console.log('geotabClient.check.ts: PASS');
}

run().catch((err) => {
  console.error('geotabClient.check.ts: FAIL', err);
  process.exit(1);
});
