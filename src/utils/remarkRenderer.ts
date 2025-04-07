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

// ---------------------------------------------
// Helpers for fallback to VS Code's built-in
// CSS for consistent markdown styling
// ---------------------------------------------
let markdownStyles: string | null = null;
let isCssLoaded = false;

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

// ---------------------------------------------
// Safely apply each plugin so we skip any that
// fail during .use(...)
// ---------------------------------------------
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
 * Renders Markdown to HTML using remark + rehype + optional built-in CSS
 */
export async function renderContent(markdown: string): Promise<string> {
  // 1) Optionally load built-in VS Code markdown CSS (only once)
  await loadMarkdownCss();

  // 2) Create the unified processor
  const processor = unified();

  // 3) Apply each plugin in sequence
  //    If a plugin fails, safeUse logs the error and continues
  safeUse(processor, remarkParse);
  safeUse(processor, remarkGfm);
  safeUse(processor, remarkRehype, { allowDangerousHtml: true } as RemarkRehypeOptions);
  safeUse(processor, rehypeRaw);
  safeUse(processor, rehypeStringify, { allowDangerousHtml: true } as RehypeStringifyOptions);

  // 4) Process the Markdown
  const file = await processor.process(markdown);

  // 5) If we have loaded markdownStyles, prepend them in a <style> block
  const contentHtml = String(file);
  const styledHtml = markdownStyles
    ? `<style>${markdownStyles}</style>\n${contentHtml}`
    : contentHtml;

  // 6) Return final HTML string
  return styledHtml;
}
