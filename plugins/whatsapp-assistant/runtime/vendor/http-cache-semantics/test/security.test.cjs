'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Policy = require('../index.js');

class ClockPolicy extends Policy {
  now() { return 1700000000000; }
}

const request = headers => ({ url: 'https://synthetic.invalid/item', method: 'GET', headers: { host: 'synthetic.invalid', ...headers } });
function policy(cacheControl, extra = {}, options = {}, reqHeaders = {}) {
  return new ClockPolicy(request(reqHeaders), { status: 200, headers: {
    'cache-control': cacheControl, age: '5', etag: '"synthetic"', ...extra,
  } }, options);
}

for (const [label, control, headers, options, reqHeaders] of [
  ['shared cookie', 'max-age=600', { 'set-cookie': 'synthetic=session' }],
  ['proxy revalidation', 'max-age=600, proxy-revalidate'],
  ['response no-cache', 'max-age=600, no-cache'],
  ['nonstorable response', 'no-store'],
  ['shared private response', 'max-age=600, private'],
  ['shared authorization', 'max-age=600', {}, {}, { authorization: 'synthetic' }],
  ['wildcard vary', 'max-age=600', { vary: '*' }],
]) {
  test(`${label}: max-stale and serialized policies require synchronous validation`, () => {
    const original = policy(control, headers, options, reqHeaders);
    for (const candidate of [original, ClockPolicy.fromObject(JSON.parse(JSON.stringify(original.toObject())))]) {
      for (const cc of ['max-stale', 'max-stale=1000000']) {
        const req = request({ 'cache-control': cc });
        assert.equal(candidate.satisfiesWithoutRevalidation(req), false);
        const result = candidate.evaluateRequest(req);
        assert.equal(result.response, undefined);
        assert.equal(result.revalidation.synchronous, true);
      }
    }
  });
}

for (const [label, control, headers] of [
  ['shared cookie', 'max-age=600', { 'set-cookie': 'synthetic=session' }],
  ['no-cache', 'max-age=600, no-cache'],
  ['proxy-revalidate', 'max-age=600, proxy-revalidate'],
  ['private', 'max-age=600, private'],
  ['no-store', 'no-store'],
  ['must-revalidate', 'max-age=0, must-revalidate'],
]) {
  test(`${label}: stale extensions and origin error cannot recover forbidden content`, () => {
    const candidate = policy(`${control}, stale-while-revalidate=600, stale-if-error=600`, headers);
    assert.equal(candidate.useStaleWhileRevalidate(), false);
    assert.equal(candidate.timeToLive(), 0);
    assert.equal(candidate.evaluateRequest(request()).response, undefined);
    const result = candidate.revalidatedPolicy(request(), { status: 503, headers: {} });
    assert.equal(result.modified, true);
    assert.notEqual(result.policy, candidate);
  });
}

test('matching 304 revalidation preserves cookie restrictions', () => {
  const candidate = policy('max-age=600', { 'set-cookie': 'synthetic=session' });
  const result = candidate.revalidatedPolicy(request(), { status: 304, headers: { etag: '"synthetic"' } });
  assert.equal(result.modified, false);
  assert.equal(result.policy.satisfiesWithoutRevalidation(request({ 'cache-control': 'max-stale' })), false);
});

test('ordinary public fresh and stale entries retain cache reuse', () => {
  assert.equal(policy('public, max-age=600').satisfiesWithoutRevalidation(request()), true);
  const expired = policy('public, max-age=0');
  assert.equal(expired.satisfiesWithoutRevalidation(request()), false);
  assert.equal(expired.satisfiesWithoutRevalidation(request({ 'cache-control': 'max-stale' })), true);
  assert.equal(expired.satisfiesWithoutRevalidation(request({ 'cache-control': 'max-stale=10' })), true);
  assert.equal(expired.satisfiesWithoutRevalidation(request({ 'cache-control': 'max-stale=1' })), false);
});

test('explicit public/immutable cookie opt-ins and private caches retain documented behavior', () => {
  for (const control of ['public, max-age=600', 'immutable, max-age=600']) {
    assert.equal(policy(control, { 'set-cookie': 'synthetic=session' }).satisfiesWithoutRevalidation(request()), true);
  }
  assert.equal(policy('max-age=600', { 'set-cookie': 'synthetic=session' }, { shared: false }).satisfiesWithoutRevalidation(request()), true);
});

test('ordinary public stale extensions and error reuse still work', () => {
  const candidate = policy('public, max-age=0, stale-while-revalidate=60, stale-if-error=60');
  assert.equal(candidate.useStaleWhileRevalidate(), true);
  assert.ok(candidate.timeToLive() > 0);
  const result = candidate.evaluateRequest(request());
  assert.ok(result.response);
  assert.equal(result.revalidation.synchronous, false);
  assert.equal(candidate.revalidatedPolicy(request(), { status: 503, headers: {} }).policy, candidate);
});
