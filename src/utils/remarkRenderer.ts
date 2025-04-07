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

let markdownStyles: string | null = null;
let isCssLoaded = false;

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
export async function renderContent(markdown: string): Promise<string> {
  await loadMarkdownCss();

  const processor = unified();

  safeUse(processor, remarkParse);
  safeUse(processor, remarkGfm);
  // Directly use the scrollSyncPlugin without safeUse
  processor.use(scrollSyncPlugin);
  safeUse(processor, remarkRehype, { allowDangerousHtml: true } as RemarkRehypeOptions);
  safeUse(processor, rehypeRaw);
  safeUse(processor, rehypeStringify, { allowDangerousHtml: true } as RehypeStringifyOptions);

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
    
    function gatherLineElements() {
      lines = Array.from(document.querySelectorAll('.code-line')).map(el => {
        const lineVal = parseInt(el.getAttribute('data-line'), 10);
        return { el, line: lineVal };
      });
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
      }
    }
    
    function scrollToLine(line) {
      const closest = findClosestLine(line);
      if (closest) {
        closest.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    
    // Editor -> Preview sync: Listen for messages from the extension.
    window.addEventListener('message', event => {
      const { command, line } = event.data;
      if (command === 'syncScroll') {
        markActiveLine(line);
        scrollToLine(line);
      }
    });
    
    // Preview -> Editor sync: When user scrolls the preview, post back the active line.
    window.addEventListener('scroll', () => {
      if (!lines.length) return;
      const offset = window.scrollY + 50; // offset from top
      let best = lines[0];
      for (const item of lines) {
        const rect = item.el.getBoundingClientRect();
        const top = rect.top + window.scrollY;
        if (top > offset) break;
        best = item;
      }
      vscode.postMessage({ command: 'previewScrolled', line: best.line });
    });
    
    // Gather all line elements after content is loaded.
    gatherLineElements();
  </script>
</body>
</html>`;
}