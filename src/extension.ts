/* eslint-disable @typescript-eslint/no-require-imports, global-require */
// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import { createCustomHtmlRenderer, createCustomImageRenderer } from './utils/VsCodePreviewHelperFunctions';
import Authord from './authordExtension';

let extensionInitializer: Authord | undefined;

export function activate(context: vscode.ExtensionContext): { extendMarkdownIt(md: any): any } {
  if (!vscode.workspace.workspaceFolders) {
    return {
      extendMarkdownIt: (md: any) => md,
    };
  }

  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
  extensionInitializer = new Authord(context, workspaceRoot);
  extensionInitializer.initialize();

  function extendMarkdownIt(md: any) {
    const config = vscode.workspace.getConfiguration('authord');
    // When useCustomPreview is true, we rely on our custom preview for rendering.
    // When false, we extend the built-in markdown-it instance.
    const useCustomPreview = config.get<boolean>('useCustomPreview', true);
    if (!useCustomPreview) {
      // Extend the renderer rules for the built-in Markdown preview.
      const { renderer } = md;
      renderer.rules.image = createCustomImageRenderer(
        renderer.rules.image,
        extensionInitializer?.documentManager
      );
      renderer.rules.html_block = createCustomHtmlRenderer(
        renderer.rules.html_block,
        extensionInitializer?.documentManager
      );
      renderer.rules.html_inline = createCustomHtmlRenderer(
        renderer.rules.html_inline,
        extensionInitializer?.documentManager
      );
  
      return md
        .use(require('markdown-it-plantuml'))
        .use(require('markdown-it-attrs'));
    }
    // Otherwise, return md unmodified (custom preview will handle rendering).
    return md;
  }

  return { extendMarkdownIt };
}

export function deactivate() {
  // Optionally, dispose the extension initializer if needed:
  // extensionInitializer?.dispose();
}
