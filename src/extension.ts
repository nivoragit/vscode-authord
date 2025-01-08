import * as vscode from 'vscode';
import { createCustomHtmlRenderer, createCustomImageRenderer, focusOrShowPreview } from './utils/helperFunctions';

import { Token } from 'markdown-it';
import { Authord } from './authordExtension';

export let initializer: Authord | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Get the workspace root
  if (!vscode.workspace.workspaceFolders) { return; }
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

  initializer = new Authord(context, workspaceRoot);
  initializer.initialize();

  // Return the extendMarkdownIt function
  return {
    extendMarkdownIt(md: any) {
      // 1) Override the standard image renderer
      const defaultImageRenderer =
        md.renderer.rules.image ||
        function (
          tokens: Token[],
          idx: number,
          options: any,
          _env: any,
          self: any
        ) {
          return self.renderToken(tokens, idx, options);
        };
      md.renderer.rules.image = createCustomImageRenderer(defaultImageRenderer, initializer?.configManager);

      // 2) Override HTML block rendering to fix <img> tags
      const defaultHtmlBlock =
        md.renderer.rules.html_block ||
        function (
          tokens: Token[],
          idx: number,
          options: any,
          _env: any,
          self: any
        ) {
          return self.renderToken(tokens, idx, options);
        };
      md.renderer.rules.html_block = createCustomHtmlRenderer(defaultHtmlBlock, initializer?.configManager);

      // 3) Override HTML inline rendering to fix <img> tags inside inline HTML
      const defaultHtmlInline =
        md.renderer.rules.html_inline ||
        function (
          tokens: Token[],
          idx: number,
          options: any,
          _env: any,
          self: any
        ) {
          return self.renderToken(tokens, idx, options);
        };
      md.renderer.rules.html_inline = createCustomHtmlRenderer(defaultHtmlInline, initializer?.configManager!);

      const defaultRender =
        md.renderer.rules.image ||
        function (
          tokens: Token[],
          idx: number,
          options: any,
          _env: any,
          self: any
        ) { return self.renderToken(tokens, idx, options); };
      md.renderer.rules.image = createCustomImageRenderer(defaultRender, initializer?.configManager!);
      // Apply your custom markdown-it plugins or rules here
      // For example, adding PlantUML support:
      return md
      .use(require('markdown-it-plantuml'))
      .use(require('markdown-it-attrs'));
    },
  };


}

export function deactivate() {
  // if (initializer) {
  //   initializer.dispose();
  // }
}