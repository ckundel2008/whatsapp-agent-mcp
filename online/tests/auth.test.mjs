import test from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, generateSecret, SignJWT } from 'jose';
import { AuthenticationError, createTokenVerifier, principalKey } from '../auth.mjs';

const issuer = 'https://issuer.example.test';
const audience = 'whatsapp-resource';

const { privateKey, publicKey } = await generateKeyPair('RS256');
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = 'test-rsa';
publicJwk.alg = 'RS256';
publicJwk.use = 'sig';

function verifier(overrides = {}) {
  return createTokenVerifier({ issuer, audience, jwks: { keys: [publicJwk] }, ...overrides });
}

async function token(overrides = {}, key = privateKey, alg = 'RS256') {
  const now = Math.floor(Date.now() / 1000);
  const omitted = overrides.__omit;
  const claims = {
    iss: issuer,
    sub: 'user-123',
    aud: audience,
    iat: now,
    exp: now + 300,
    ...overrides,
  };
  delete claims.__omit;
  if (omitted) delete claims[omitted];
  return new SignJWT(claims).setProtectedHeader({ alg, kid: 'test-rsa', typ: 'JWT' }).sign(key);
}

async function assertInvalid(promise) {
  await assert.rejects(promise, (error) => {
    assert.equal(error instanceof AuthenticationError, true);
    assert.equal(error.code, 'invalid_token');
    assert.equal(error.message, 'invalid token');
    return true;
  });
}

test('verifies RS256 token and returns the exact authenticated identity', async () => {
  const identity = await verifier()(await token({ scope: 'read write' }));
  assert.deepEqual(identity, { issuer, subject: 'user-123', scopes: ['read', 'write'] });
  assert.equal(Object.isFrozen(identity), true);
  assert.equal(Object.isFrozen(identity.scopes), true);
  assert.equal(principalKey(identity), JSON.stringify([issuer, 'user-123']));
});

test('rejects altered signatures and unsigned tokens', async () => {
  const signed = await token();
  const signedParts = signed.split('.');
  const signature = Buffer.from(signedParts[2], 'base64url');
  signature[0] ^= 1;
  signedParts[2] = signature.toString('base64url');
  const altered = signedParts.join('.');
  await assertInvalid(verifier()(altered));
  const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${signed.split('.')[1]}.`;
  await assertInvalid(verifier()(unsigned));
});

test('requires issuer, subject, audience, expiration and issued-at claims', async () => {
  for (const claim of ['iss', 'sub', 'aud', 'exp', 'iat']) {
    const now = Math.floor(Date.now() / 1000);
    await assertInvalid(verifier()(await token({ __omit: claim, iat: now, exp: now + 300 })));
  }
});

test('checks issuer, audience, nbf, age and maximum token lifetime', async () => {
  await assertInvalid(verifier()(await token({ iss: 'https://other.example.test' })));
  await assertInvalid(verifier()(await token({ aud: 'other-resource' })));
  await assertInvalid(verifier()(await token({ nbf: Math.floor(Date.now() / 1000) + 120 })));
  await assertInvalid(verifier()(await token({ iat: Math.floor(Date.now() / 1000) + 120 })));
  await assertInvalid(verifier()(await token({ iat: Math.floor(Date.now() / 1000) - 601 })));
  await assertInvalid(verifier()(await token({ exp: Math.floor(Date.now() / 1000) + 601 })));
});

test('allows only RS256 and ES256 signatures', async () => {
  const { privateKey: ecPrivate, publicKey: ecPublic } = await generateKeyPair('ES256');
  const ecJwk = await exportJWK(ecPublic);
  ecJwk.kid = 'test-rsa';
  ecJwk.alg = 'ES256';
  const ecVerifier = createTokenVerifier({ issuer, audience, jwks: { keys: [ecJwk] } });
  assert.equal((await ecVerifier(await token({}, ecPrivate, 'ES256'))).subject, 'user-123');
  const hmacKey = await generateSecret('HS256');
  await assertInvalid(verifier()(await token({}, hmacKey, 'HS256')));
});

test('rejects malformed or oversized scopes and subjects', async () => {
  await assertInvalid(verifier()(await token({ scope: 'read\twrite' })));
  await assertInvalid(verifier()(await token({ scope: 'x'.repeat(2049) })));
  await assertInvalid(verifier()(await token({ scope: 42 })));
  await assertInvalid(verifier()(await token({ sub: '' })));
  await assertInvalid(verifier()(await token({ sub: 'x'.repeat(257) })));
});

test('validates verifier configuration and rejects unknown key ids', async () => {
  assert.throws(() => createTokenVerifier({ issuer: 'issuer.example', audience, jwks: { keys: [publicJwk] } }), /HTTPS/);
  assert.throws(() => createTokenVerifier({ issuer: 'http://issuer.example', audience, jwks: { keys: [publicJwk] } }), /HTTPS/);
  assert.throws(() => createTokenVerifier({ issuer, audience, jwksUrl: 'http://issuer.example/jwks' }), /HTTPS/);
  assert.throws(() => createTokenVerifier({ issuer, audience, jwks: { keys: [] } }), /JSON Web Key Set/);
  assert.throws(() => createTokenVerifier({ issuer, audience, jwks: { keys: [publicJwk] }, maxTokenAgeSeconds: 601 }), /maxTokenAgeSeconds/);
  const unknownKid = await new SignJWT({ iss: issuer, sub: 'user-123', aud: audience, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 })
    .setProtectedHeader({ alg: 'RS256', kid: 'unknown' }).sign(privateKey);
  await assertInvalid(verifier()(unknownKid));
});

test('rejects blank and control-character subjects', async () => {
  await assertInvalid(verifier()(await token({ sub: '' })));
  await assertInvalid(verifier()(await token({ sub: 'user\n123' })));
  await assertInvalid(verifier()(await token({ sub: 'user\u0000' })));
});
