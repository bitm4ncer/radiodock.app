import { generateToken, sha256, encryptPayload, decryptPayload, extractTokenFromInput, computeContentHash, SyncError } from '../src/data/sync.js';

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

await test('sha256 produces correct hash for known input', async () => {
  const hash = await sha256('hello');
  assert(hash === '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', `got ${hash}`);
});

await test('encryptPayload + decryptPayload round-trip', async () => {
  const token = generateToken();
  const plain = JSON.stringify({ test: 'hello world', stations: [1, 2, 3] });
  const envelope = await encryptPayload(plain, token);
  const decrypted = await decryptPayload(envelope, token);
  assert(decrypted === plain);
});

await test('decryptPayload fails with wrong token', async () => {
  const tokenA = generateToken();
  const tokenB = generateToken();
  const envelope = await encryptPayload('test', tokenA);
  try {
    await decryptPayload(envelope, tokenB);
    assert(false, 'should have thrown');
  } catch (err) {
    assert(err instanceof SyncError);
    assert(err.type === 'decrypt');
  }
});

await test('decryptPayload fails with corrupted ciphertext', async () => {
  const token = generateToken();
  const envelope = await encryptPayload('test', token);
  const parsed = JSON.parse(envelope);
  parsed.ct = 'AAAA';
  try {
    await decryptPayload(JSON.stringify(parsed), token);
    assert(false, 'should have thrown');
  } catch (err) {
    assert(err instanceof SyncError);
  }
});

await test('decryptPayload fails with unknown version', async () => {
  try {
    await decryptPayload(JSON.stringify({ v: 99, iv: 'AA', ct: 'AA' }), generateToken());
    assert(false, 'should have thrown');
  } catch (err) {
    assert(err instanceof SyncError);
  }
});

await test('generateToken produces valid UUIDv4', () => {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (let i = 0; i < 10; i++) {
    assert(re.test(generateToken()), generateToken());
  }
});

await test('computeContentHash is deterministic', async () => {
  const json = '{"a":1,"b":2}';
  const h1 = await computeContentHash(json);
  const h2 = await computeContentHash(json);
  assert(h1 === h2);
});

await test('extractTokenFromInput extracts from URL and bare UUID', () => {
  const token = '12345678-abcd-4ef0-1234-567890abcdef';
  assert(extractTokenFromInput(token) === token);
  assert(extractTokenFromInput(`https://radiodock.app/#sync=${token}`) === token);
  assert(extractTokenFromInput('not a token') === null);
  assert(extractTokenFromInput('') === null);
});

console.log('\nAll sync crypto tests complete');
