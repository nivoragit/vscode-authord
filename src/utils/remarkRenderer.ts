// src/utils/remarkRenderer.ts
import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path';

// Unified + remark + rehype imports
import { unified, Processor } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype, { Options as RemarkRehypeOptions } from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify, { Options as RehypeStringifyOptions } from 'rehype-stringify';
import { scrollSyncPlugin } from './scrollSyncPlugin';
import { imageRootPlugin } from './imageRootPlugin';
import { visitParents } from 'unist-util-visit-parents';

let markdownStyles: string | null = null;
let isCssLoaded = false;

// Full brace‑block attribute support for *any* element
function braceAttributes() {
  return (tree: any) => {
    visitParents(tree, 'text', (textNode, ancestors) => {
      const m = textNode.value.match(/^\{\s*([^}]*)\}/);
      if (!m) return;

      // the element immediately before this text node
      const parent = ancestors[ancestors.length - 1];
      const idx = parent.children.indexOf(textNode);
      if (idx === 0) return;                 // nothing before it
      const el = parent.children[idx - 1];
      if (el.type !== 'element') return;     // only attach to elements

      // --- parse attributes ---
      m[1].trim().split(/\s+/).forEach((pair: string) => {
        if (!pair) return;
        if (pair.startsWith('.')) {
          // class
          el.properties.className = [
            ...(el.properties.className || []),
            pair.slice(1),
          ];
        } else if (pair.startsWith('#')) {
          el.properties.id = pair.slice(1);
        } else {
          let [k, v = ''] = pair.split('=');
          v = v.replace(/^["']|["']$/g, ''); // strip quotes
          el.properties[k] = v;
        }
      });

      // remove or trim brace text
      textNode.value = textNode.value.slice(m[0].length);
      if (!textNode.value) parent.children.splice(idx, 1);
    });
  };
}

/**
 * Load VS Code's built-in markdown.css for consistent styling.
 */
async function loadMarkdownCss(): Promise<void> {
  if (!isCssLoaded) {
    const markdownExtension = vscode.extensions.getExtension('vscode.markdown-language-features');
    if (markdownExtension) {
      const markdownCssPath = path.join(markdownExtension.extensionPath, 'media', 'markdown.css');
      try {
        markdownStyles = await fs.readFile(markdownCssPath, 'utf-8');
      } catch (error) {
        console.warn('Failed to load VS Code Markdown styles:', error);
        markdownStyles = null;
      }
    } else {
      console.warn('VS Code Markdown extension not found. Proceeding without built-in styles.');
      markdownStyles = null;
    }
    isCssLoaded = true;
  }
}

/**
 * Safely apply plugins so that failures do not break the pipeline.
 */
function safeUse(
  processor: Processor,
  plugin: any,
  options?: RemarkRehypeOptions | RehypeStringifyOptions | Record<string, unknown>
) {
  try {
    processor.use(plugin, options);
  } catch (error) {
    console.warn(
      `Warning: Plugin "${plugin?.name || 'unknown'}" failed and will be skipped.`,
      error
    );
  }
}

/**
 * Renders Markdown to HTML using remark + rehype, injecting line data via scrollSyncPlugin.
 * The final HTML is wrapped with additional CSS and a script to support two-way scroll sync.
 */
export async function renderContent(markdown: string, imageFolder: string | undefined, docPath: string | undefined): Promise<string> {
  await loadMarkdownCss();

  const processor = unified();

  safeUse(processor, remarkParse);
  safeUse(processor, remarkGfm);
  // Directly use the scrollSyncPlugin without safeUse
  processor.use(scrollSyncPlugin);
  safeUse(processor, remarkRehype, { allowDangerousHtml: true } as RemarkRehypeOptions);
  safeUse(processor, rehypeRaw);
  safeUse(processor, braceAttributes);
  safeUse(processor, rehypeStringify, { allowDangerousHtml: true } as RehypeStringifyOptions);
  if (imageFolder) {
    safeUse(processor, imageRootPlugin, { imageFolder, docPath });
  }

  const file = await processor.process(markdown);
  const contentHtml = String(file);
  const styledHtml = markdownStyles
    ? `<style>${markdownStyles}</style>\n${contentHtml}`
    : contentHtml;

  // Wrap the generated HTML with the embedded script and updated CSS for two-way scroll sync.
  return wrapWithSyncScript(styledHtml);
}

/**
 * Wraps the rendered HTML with additional CSS (including a vertical line for the active line)
 * and an embedded script for two-way scroll sync.
 */
function wrapWithSyncScript(innerHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body {
      margin: 0;
      padding: 1rem;
    }
    /* Active line gets a vertical line on the left.
       It uses the VS Code theme variable for scrollbar slider active background. */
    .code-active-line {
      position: relative;
    }
    .code-active-line::before {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      left: -8px;
      width: 3px;
      background-color: var(--vscode-scrollbarSlider-activeBackground, rgba(230, 100, 100, 0.8));
    }
  </style>
</head>
<body>
  ${innerHtml}
  <script>
    const vscode = acquireVsCodeApi();
    let lines = [];
    let currentActive = null;

    function isElementVisible(el) {
      let current = el;
      while (current) {
        if (current.tagName === 'DETAILS' && !current.open) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    }

    function gatherLineElements() {
      const allLines = Array.from(document.querySelectorAll('.code-line'));
      lines = [];
      for (const el of allLines) {
        if (!isElementVisible(el)) continue;
        const lineVal = parseInt(el.getAttribute('data-line'), 10);
        const rect = el.getBoundingClientRect();
        const top = rect.top + window.scrollY;
        const height = rect.height;
        lines.push({ el, line: lineVal, top, height });
      }
      lines.sort((a, b) => a.top - b.top);
    }

    function findClosestLine(targetLine) {
      if (!lines.length) return null;
      let closest = lines[0];
      for (const item of lines) {
        if (Math.abs(item.line - targetLine) < Math.abs(closest.line - targetLine)) {
          closest = item;
        }
      }
      return closest;
    }

    function markActiveLine(line) {
  if (currentActive) {
    currentActive.classList.remove('code-active-line');
  }
  const closest = findClosestLine(line);
  if (closest) {
    closest.el.classList.add('code-active-line');
    currentActive = closest.el;
    // Smooth scroll such that the active line is at the top of the preview.
    const targetTop = closest.top;
    window.scrollTo({ top: targetTop, behavior: 'smooth' });
  }
}


    document.addEventListener('toggle', (event) => {
      if (event.target.tagName === 'DETAILS') {
        gatherLineElements();
      }
    }, true);

    window.addEventListener('message', (event) => {
      const { command, line } = event.data;
      if (command === 'syncScroll') {
        markActiveLine(line);
      }
    });

    window.addEventListener('scroll', () => {
      if (!lines.length) return;
      const offset = window.scrollY + (window.innerHeight / 2);
      let low = 0, high = lines.length - 1, best = lines[0];
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const current = lines[mid];
        if (current.top <= offset) {
          best = current;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      vscode.postMessage({ command: 'previewScrolled', line: best.line });
    });

    gatherLineElements();
  </script>
</body>
</html>`;
}