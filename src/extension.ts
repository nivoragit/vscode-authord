/* eslint-disable @typescript-eslint/no-require-imports, global-require */
// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import { createCustomHtmlRenderer, createCustomImageRenderer } from './utils/helperFunctions';
import Authord from './AuthordExtension';

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
    // Safely override renderer rules directly on the original md instance
    const {renderer} = md;
    renderer.rules.image = createCustomImageRenderer(
      renderer.rules.image,
      extensionInitializer?.configManager
    );
  
    renderer.rules.html_block = createCustomHtmlRenderer(
      renderer.rules.html_block,
      extensionInitializer?.configManager
    );
  
    renderer.rules.html_inline = createCustomHtmlRenderer(
      renderer.rules.html_inline,
      extensionInitializer?.configManager
    );
  
    // Return the original md instance and apply markdown-it plugins
    return md
      .use(require('markdown-it-plantuml'))
      .use(require('markdown-it-attrs'));
  }
  

  return {
    extendMarkdownIt,
  };
}

export function deactivate() {
  // if (extensionInitializer) {
  //   extensionInitializer.dispose();
  // }
}

