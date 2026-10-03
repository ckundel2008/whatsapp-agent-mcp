'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const braces = require('..');

const assertDepthError = fn => {
  assert.throws(fn, error => error instanceof SyntaxError && error.code === 'BRACES_MAX_DEPTH');
};

const assertInvalidAstError = fn => {
  assert.throws(fn, error => error instanceof SyntaxError && error.code === 'BRACES_INVALID_AST');
};

const deep = (open, close, count = 4000) => open.repeat(count) + 'x' + close.repeat(count);

const nestedAst = (depth = 129) => {
  const root = { type: 'root', nodes: [] };
  let parent = root;
  for (let index = 0; index < depth; index++) {
    const node = { type: 'brace', nodes: [], parent };
    parent.nodes.push(node);
    parent = node;
  }
  parent.nodes.push({ type: 'text', value: 'x', parent });
  return root;
};

test('keeps ordinary brace expansion, compilation and stringification stable', () => {
  const pattern = 'src/{a,b}/file-{1..3}.js';
  assert.equal(braces.compile(pattern), 'src/(a|b)/file-([1-3]).js');
  assert.deepEqual(braces.expand(pattern), [
    'src/a/file-1.js', 'src/a/file-2.js', 'src/a/file-3.js',
    'src/b/file-1.js', 'src/b/file-2.js', 'src/b/file-3.js'
  ]);
  assert.equal(braces.stringify(braces.parse(pattern)), pattern);
  assert.deepEqual(braces.expand('{a,"b,c"}'), ['a', 'b,c']);
  assert.deepEqual(braces.expand('{a,\\{b\\}}'), ['a', '{b}']);
});

test('rejects deeply nested brace and parenthesis patterns before AST construction', () => {
  for (const pattern of [deep('{', '}'), deep('(', ')'), deep('(', '')]) {
    assertDepthError(() => braces.parse(pattern));
  }
});

test('accepts the boundary and literal constructs without treating them as nesting', () => {
  assert.doesNotThrow(() => braces.parse(deep('{', '}', 128)));
  assertDepthError(() => braces.parse(deep('{', '}', 129)));
  assert.doesNotThrow(() => braces.parse('\\{'.repeat(4000)));
  assert.doesNotThrow(() => braces.parse('"' + '{'.repeat(4000) + '"'));
  assert.doesNotThrow(() => braces.parse('['.repeat(4000) + ']'.repeat(4000)));
  assert.doesNotThrow(() => braces.parse('{}'.repeat(4000)));
});

test('rejects adversarial input through every public string entry point', () => {
  const pattern = deep('{', '}');
  const attemptedOverride = { maxDepth: Infinity, depth: Infinity };
  for (const entrypoint of [
    () => braces(pattern, attemptedOverride),
    () => braces.create(pattern, attemptedOverride),
    () => braces.parse(pattern, attemptedOverride),
    () => braces.stringify(pattern, attemptedOverride),
    () => braces.compile(pattern, attemptedOverride),
    () => braces.expand(pattern, attemptedOverride)
  ]) {
    assertDepthError(entrypoint);
  }
});

test('rejects direct deep and cyclic ASTs through recursive public entry points', () => {
  for (const method of [braces.stringify, braces.compile, braces.expand]) {
    assertDepthError(() => method(nestedAst(), { maxDepth: Infinity }));
    const cyclic = { type: 'root', nodes: [] };
    cyclic.nodes.push(cyclic);
    assertDepthError(() => method(cyclic));
  }
});

test('rejects hostile direct AST value and node shapes before recursive coercion', () => {
  let deeplyNestedValue = 'x';
  for (let index = 0; index < 5000; index++) deeplyNestedValue = [deeplyNestedValue];
  const cyclicValue = {};
  cyclicValue.self = cyclicValue;
  const invalidAsts = [
    [],
    { type: 'root', nodes: [{ type: 'text', value: deeplyNestedValue }] },
    { type: 'root', nodes: [{ type: 'text', value: cyclicValue }] },
    { type: 'root', nodes: {} },
    { type: 'root', nodes: [[]] }
  ];

  for (const method of [braces.stringify, braces.compile, braces.expand]) {
    for (const ast of invalidAsts) assertInvalidAstError(() => method(ast));
  }
});

test('continues to accept parsed ASTs supplied directly to public methods', () => {
  const pattern = 'src/{a,b}/file-{1..3}.js';
  assert.equal(braces.compile(braces.parse(pattern)), 'src/(a|b)/file-([1-3]).js');
  assert.equal(braces.stringify(braces.parse(pattern)), pattern);
  assert.deepEqual(braces.expand(braces.parse(pattern)), [
    'src/a/file-1.js', 'src/a/file-2.js', 'src/a/file-3.js',
    'src/b/file-1.js', 'src/b/file-2.js', 'src/b/file-3.js'
  ]);
});
