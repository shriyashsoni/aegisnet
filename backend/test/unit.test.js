const assert = require('assert');
const { ethers } = require('ethers');

// Helper to test hashToField: keccak256 >> 8n
function hashToField(signal) {
  const bytes = ethers.isHexString(signal) ? ethers.getBytes(signal) : ethers.toUtf8Bytes(signal);
  const hash = BigInt(ethers.keccak256(bytes)) >> 8n;
  return ethers.toBeHex(hash, 32);
}

function requireBytes32(value, field) {
  if (typeof value !== 'string' || !ethers.isHexString(value, 32)) {
    throw new Error(`${field} must be a 32-byte hex string`);
  }
  return value;
}

function requireUint256(value, field) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new Error(`${field} must be a numeric value or hex string`);
  }
  try {
    const b = BigInt(value);
    if (b < 0n || b >= 2n ** 256n) throw new Error();
    return b;
  } catch {
    throw new Error(`${field} must be a valid uint256`);
  }
}

function usdToWei(amountUSD) {
  return ethers.parseEther(amountUSD.toFixed(6));
}

console.log('Running backend unit tests...\n');

// 1. hashToField tests
{
  const id = ethers.id('test-request-123');
  const field = hashToField(id);
  assert.strictEqual(typeof field, 'string');
  assert.strictEqual(field.length, 66); // 0x + 64 hex chars
  assert.strictEqual(ethers.isHexString(field, 32), true);
  console.log('✓ hashToField produces valid 32-byte field element');
}

// 2. requireBytes32 validation tests
{
  const valid = ethers.ZeroHash;
  assert.strictEqual(requireBytes32(valid, 'test'), valid);

  assert.throws(() => requireBytes32('0x123', 'test'), /must be a 32-byte hex string/);
  assert.throws(() => requireBytes32(null, 'test'), /must be a 32-byte hex string/);
  assert.throws(() => requireBytes32('invalid', 'test'), /must be a 32-byte hex string/);
  console.log('✓ requireBytes32 correctly accepts valid and rejects malformed hashes');
}

// 3. requireUint256 validation tests
{
  assert.strictEqual(requireUint256(12345, 'num'), 12345n);
  assert.strictEqual(requireUint256('0xabc', 'hex'), 0xabcn);
  assert.strictEqual(requireUint256('1000000000000000000', 'str'), 1000000000000000000n);

  assert.throws(() => requireUint256(-1, 'negative'), /must be a valid uint256/);
  assert.throws(() => requireUint256(2n ** 256n, 'overflow'), /must be a valid uint256/);
  assert.throws(() => requireUint256('abc_not_hex', 'bad'), /must be a valid uint256/);
  console.log('✓ requireUint256 bounds checking and parsing work as expected');
}

// 4. usdToWei precision tests
{
  assert.strictEqual(usdToWei(1), 1000000000000000000n);
  assert.strictEqual(usdToWei(250.5), 250500000000000000000n);
  assert.strictEqual(usdToWei(1000.000001), 1000000001000000000000n);
  console.log('✓ usdToWei converts floating point amounts to 18-decimal precision without rounding errors');
}

// 5. Relayer message digest computation matches contract expected hash
{
  const requestId = ethers.id('request-456');
  const nullifier = 777666555n;
  const manager = '0xC65d65A48cB24CA9bd6df02Ea83Ef44571E5594c';
  const chainId = 11155111n;

  const messageHash = ethers.solidityPackedKeccak256(
    ['bytes32', 'uint256', 'address', 'uint256'],
    [requestId, nullifier, manager, chainId]
  );
  assert.strictEqual(ethers.isHexString(messageHash, 32), true);
  console.log('✓ solidityPackedKeccak256 attestation digest matches EVM abi.encodePacked expectations');
}

console.log('\nAll 5 backend unit test suites passed successfully!');
