import * as vscode from 'vscode';
import { AuthordViewProvider } from './views/authordViewProvider';
import { configExists, createCustomHtmlRenderer, createCustomImageRenderer, focusOrShowPreview } from './utils/helperFunctions';
import { Authord } from './authordExtension';
import { Token } from 'markdown-it';

export let initializer: Authord | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Get the workspace root
  if (!vscode.workspace.workspaceFolders) { return; }
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

  initializer = new Authord(context, workspaceRoot);

  // Listen for when the active editor changes
  // context.subscriptions.push(
  //   vscode.window.onDidChangeActiveTextEditor(async (editor) => {
  //     if (editor && editor.document.languageId === 'markdown') {
  //       // Focus the existing preview if it's open
  //       await focusExistingPreview();
  //     }
  //   })
  // );

  // Register the Authord Documentation View
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AuthordViewProvider.viewType, // ID from package.json
      new AuthordViewProvider(context, workspaceRoot)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('authordExtension.openMarkdownFile', async (resourceUri: vscode.Uri) => {
      if (!configExists) {
        return;
      }
      // Open the markdown file in the first column
      const document = await vscode.workspace.openTextDocument(resourceUri);
      await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

      // Focus the existing preview or open it if it doesn't exist
      await focusOrShowPreview();

    })
  );
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
      md.renderer.rules.image = createCustomImageRenderer(defaultImageRenderer);

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
      md.renderer.rules.html_block = createCustomHtmlRenderer(defaultHtmlBlock);

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
      md.renderer.rules.html_inline = createCustomHtmlRenderer(defaultHtmlInline);

      const defaultRender =
        md.renderer.rules.image ||
        function (
          tokens: Token[],
          idx: number,
          options: any,
          _env: any,
          self: any
        ) { return self.renderToken(tokens, idx, options); };
      md.renderer.rules.image = createCustomImageRenderer(defaultRender);
      // Apply your custom markdown-it plugins or rules here
      // For example, adding PlantUML support:
      return md.use(require('markdown-it-plantuml'));
    },
  };


}

export function deactivate() {
  // if (initializer) {
  //   initializer.dispose();
  // }
}