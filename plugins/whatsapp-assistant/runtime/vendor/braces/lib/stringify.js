'use strict';

const utils = require('./utils');

module.exports = (ast, options = {}) => {
  const guard = utils.createTraversalGuard();
  const stringify = (node, parent = {}, depth = 0) => {
    guard.enter(node, depth);
    try {
      const invalidBlock = options.escapeInvalid && utils.isInvalidBrace(parent);
      const invalidNode = node.invalid === true && options.escapeInvalid === true;
      let output = '';

      if (node.value) {
        if ((invalidBlock || invalidNode) && utils.isOpenOrClose(node)) {
          return '\\' + node.value;
        }
        return node.value;
      }

      if (node.value) {
        return node.value;
      }

      if (node.nodes) {
        for (const child of node.nodes) {
          // Upstream intentionally does not pass its parent into recursive
          // stringification. Keep that escapeInvalid behavior unchanged.
          output += stringify(child, {}, depth + 1);
        }
      }

      return output;
    } finally {
      guard.leave(node);
    }
  };

  return stringify(ast);
};
