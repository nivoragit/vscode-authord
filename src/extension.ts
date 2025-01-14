/* eslint-disable @typescript-eslint/no-require-imports, global-require */
// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import { Token } from 'markdown-it';
import { createCustomHtmlRenderer, createCustomImageRenderer } from './utils/helperFunctions';
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

  function extendMarkdownIt(originalMd: any) {
    const md = { ...originalMd };
    const renderer = {
      ...originalMd.renderer,
      rules: { ...originalMd.renderer.rules },
    };

    function defaultImageRendererFunc(
      tokens: Token[],
      idx: number,
      options: any,
      _env: any,
      self: any
    ) {
      return self.renderToken(tokens, idx, options);
    }
    renderer.rules.image = createCustomImageRenderer(
      renderer.rules.image || defaultImageRendererFunc,
      extensionInitializer?.configManager
    );

    function defaultHtmlBlockFunc(
      tokens: Token[],
      idx: number,
      options: any,
      _env: any,
      self: any
    ) {
      return self.renderToken(tokens, idx, options);
    }
    renderer.rules.html_block = createCustomHtmlRenderer(
      renderer.rules.html_block || defaultHtmlBlockFunc,
      extensionInitializer?.configManager
    );

    function defaultHtmlInlineFunc(
      tokens: Token[],
      idx: number,
      options: any,
      _env: any,
      self: any
    ) {
      return self.renderToken(tokens, idx, options);
    }
    renderer.rules.html_inline = createCustomHtmlRenderer(
      renderer.rules.html_inline || defaultHtmlInlineFunc,
      extensionInitializer?.configManager
    );

    function defaultRenderFunc(
      tokens: Token[],
      idx: number,
      options: any,
      _env: any,
      self: any
    ) {
      return self.renderToken(tokens, idx, options);
    }
    renderer.rules.image = createCustomImageRenderer(
      renderer.rules.image || defaultRenderFunc,
      extensionInitializer?.configManager
    );

    md.renderer = renderer;
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
