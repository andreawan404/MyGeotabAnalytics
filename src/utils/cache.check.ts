import assert from 'node:assert';
import { getCached, setCached, buildCacheKey } from './cache';

async function run() {
  await setCached('k', 'v', 60000);
  assert.strictEqual(await getCached('k'), 'v', 'fresh key should hit');

  await setCached('k2', 'v2', -1); // already expired
  assert.strictEqual(await getCached('k2'), null, 'expired key should miss');

  assert.notStrictEqual(buildCacheKey('dbA', 'x'), buildCacheKey('dbB', 'x'), 'keys must be scoped per database');

  const usedIndexedDb = typeof indexedDB !== 'undefined';
  console.log(
    `cache.check.ts: PASS (${usedIndexedDb ? 'ran against real indexedDB' : 'ran against in-memory fallback — indexedDB not present in this runtime'})`
  );
}

run().catch((err) => {
  console.error('cache.check.ts: FAIL', err);
  process.exit(1);
});
