const assert = require('node:assert/strict');
const { sprintf, vsprintf } = require('../src/sprintf.js');

assert.equal(sprintf('%.2f', 1.25), '1.25');
assert.equal(sprintf('%s', 'ok'), 'ok');
assert.equal(vsprintf('%s %d', ['ok', 4]), 'ok 4');
assert.equal(sprintf('%(name)s', { name: 'Ada' }), 'Ada');
assert.equal(sprintf('%.1000000000f', 1).length <= 102, true);
assert.equal(sprintf('%.1000000000e', 1).length <= 108, true);
assert.equal(sprintf('%.1000000000g', 1).length <= 102, true);
assert.equal(sprintf('%.0g', 1), '1');
assert.equal(sprintf('%.1000000000s', 'abcdef'), 'abcdef');
