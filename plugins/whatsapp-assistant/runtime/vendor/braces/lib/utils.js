'use strict';

// This limit is deliberately not configurable. User-controlled patterns and
// caller-supplied ASTs must not be able to exhaust the JavaScript call stack.
exports.MAX_DEPTH = 128;
exports.MAX_DEPTH_ERROR_CODE = 'BRACES_MAX_DEPTH';
exports.INVALID_AST_ERROR_CODE = 'BRACES_INVALID_AST';

exports.maxDepthError = () => {
  const error = new SyntaxError(`Brace nesting exceeds the maximum depth of ${exports.MAX_DEPTH}`);
  error.code = exports.MAX_DEPTH_ERROR_CODE;
  return error;
};

exports.invalidAstError = () => {
  const error = new SyntaxError('Invalid braces AST node');
  error.code = exports.INVALID_AST_ERROR_CODE;
  return error;
};

exports.assertAstNode = node => {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throw exports.invalidAstError();
  }
  if (Object.prototype.hasOwnProperty.call(node, 'value') && typeof node.value !== 'string') {
    throw exports.invalidAstError();
  }
  if (node.nodes !== undefined && !Array.isArray(node.nodes)) {
    throw exports.invalidAstError();
  }
};

/**
 * Guard recursive AST walkers. `active` catches cycles while `depth` protects
 * deep ASTs supplied directly to the public compile/expand/stringify APIs.
 */
exports.createTraversalGuard = () => {
  const active = new Set();

  return {
    enter(node, depth) {
      exports.assertAstNode(node);
      if (depth > exports.MAX_DEPTH || (node && typeof node === 'object' && active.has(node))) {
        throw exports.maxDepthError();
      }
      if (node && typeof node === 'object') active.add(node);
    },
    assertNode(node) {
      exports.assertAstNode(node);
    },
    leave(node) {
      if (node && typeof node === 'object') active.delete(node);
    },
    parent(node, predicate) {
      const seen = new Set();
      let current = node;
      let depth = 0;
      while (current && !predicate(current) && current.parent) {
        if (depth++ >= exports.MAX_DEPTH || seen.has(current)) {
          throw exports.maxDepthError();
        }
        seen.add(current);
        current = current.parent;
      }
      return current;
    }
  };
};

exports.isInteger = num => {
  if (typeof num === 'number') {
    return Number.isInteger(num);
  }
  if (typeof num === 'string' && num.trim() !== '') {
    return Number.isInteger(Number(num));
  }
  return false;
};

/**
 * Find a node of the given type
 */

exports.find = (node, type) => node.nodes.find(node => node.type === type);

/**
 * Find a node of the given type
 */

exports.exceedsLimit = (min, max, step = 1, limit) => {
  if (limit === false) return false;
  if (!exports.isInteger(min) || !exports.isInteger(max)) return false;
  return ((Number(max) - Number(min)) / Number(step)) >= limit;
};

/**
 * Escape the given node with '\\' before node.value
 */

exports.escapeNode = (block, n = 0, type) => {
  const node = block.nodes[n];
  if (!node) return;

  if ((type && node.type === type) || node.type === 'open' || node.type === 'close') {
    if (node.escaped !== true) {
      node.value = '\\' + node.value;
      node.escaped = true;
    }
  }
};

/**
 * Returns true if the given brace node should be enclosed in literal braces
 */

exports.encloseBrace = node => {
  if (node.type !== 'brace') return false;
  if ((node.commas >> 0 + node.ranges >> 0) === 0) {
    node.invalid = true;
    return true;
  }
  return false;
};

/**
 * Returns true if a brace node is invalid.
 */

exports.isInvalidBrace = block => {
  if (block.type !== 'brace') return false;
  if (block.invalid === true || block.dollar) return true;
  if ((block.commas >> 0 + block.ranges >> 0) === 0) {
    block.invalid = true;
    return true;
  }
  if (block.open !== true || block.close !== true) {
    block.invalid = true;
    return true;
  }
  return false;
};

/**
 * Returns true if a node is an open or close node
 */

exports.isOpenOrClose = node => {
  if (node.type === 'open' || node.type === 'close') {
    return true;
  }
  return node.open === true || node.close === true;
};

/**
 * Reduce an array of text nodes.
 */

exports.reduce = nodes => nodes.reduce((acc, node) => {
  if (node.type === 'text') acc.push(node.value);
  if (node.type === 'range') node.type = 'text';
  return acc;
}, []);

/**
 * Flatten an array
 */

exports.flatten = (...args) => {
  const result = [];

  const flat = arr => {
    for (let i = 0; i < arr.length; i++) {
      const ele = arr[i];

      if (Array.isArray(ele)) {
        flat(ele);
        continue;
      }

      if (ele !== undefined) {
        result.push(ele);
      }
    }
    return result;
  };

  flat(args);
  return result;
};
