// src/plugins/scrollSyncPlugin.ts
import { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

export const scrollSyncPlugin: Plugin = function() {
  return (tree) => {
    visit(tree, (node: any) => {
      if (node.type === 'heading' || node.type === 'paragraph' || node.type === 'code') {
        const line = node.position?.start?.line;
        if (typeof line === 'number') {
          node.data = node.data || {};
          node.data.hProperties = node.data.hProperties || {};
          node.data.hProperties.class = node.data.hProperties.class
            ? `${node.data.hProperties.class} code-line`
            : 'code-line';
          node.data.hProperties['data-line'] = String(line);
        }
      }
    });
  };
};
