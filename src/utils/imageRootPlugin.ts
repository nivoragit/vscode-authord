// src/utils/imageRootPlugin.ts
import { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
import type { Root, Element } from 'hast';
import * as path from 'path';


/**
 * A custom rehype plugin that rewrites the src attribute of <img> tags by prepending
 * a folder path. If `imageFolder` is absolute, we compute a relative folder path
 * from the Markdown document's directory. For local image references like `cat.png`,
 * it becomes something like `../assets/cat.png`.
 */
export function imageRootPlugin(options: { imageFolder: string; docPath: string }): Plugin<[Root]> {
  const { imageFolder, docPath } = options;

  // Compute the effective folder:
  // If `imageFolder` is absolute, make it relative to the Markdown file's directory
  const effectiveImageFolder = path.isAbsolute(imageFolder)
    ? path.relative(docPath, imageFolder)
    : imageFolder;

  return (tree: Root) => {
    visit(tree, (node) => {
      // We only want to handle <img> elements
      if (node.type === 'element') {
        const el = node as Element;
        if (el.tagName === 'img' && el.properties && el.properties.src) {
          const src = String(el.properties.src);
          // Skip rewriting if it’s an HTTP or data URI
          if (/^https?:\/\//.test(src) || /^data:/.test(src)) {
            return;
          }
          // Prepend our effective folder and normalize the path separators
          const newSrc = path
            .join(effectiveImageFolder, src);
          el.properties.src = newSrc;
          
        }
      }
    });
  };
}
