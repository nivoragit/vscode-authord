// src/commands/registerCommands.ts
import * as vscode from 'vscode';
import { previewManager } from '../views/previewManager.js';
import { WriterJetTreeDataProvider } from '../views/writerJetTreeDataProviderTreeDataProvider.js';

import { checkConfigFile } from '../utils/helperFunctions.js';

export function registerCommands(context: vscode.ExtensionContext) {
  const treeDataProvider = new WriterJetTreeDataProvider();
  vscode.window.registerTreeDataProvider('writerjetExtensionView', treeDataProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand('writerjetExtension.openMarkdownFile', async (resourceUri: vscode.Uri) => {
      // Shift focus back to the editor
      const editors = vscode.window.visibleTextEditors.filter(
        (editor) => editor.viewColumn === vscode.ViewColumn.One
      );
      if (editors.length > 0) {
        await vscode.window.showTextDocument(editors[0].document, vscode.ViewColumn.One, false);
      }

      // Open the markdown file in the first column
      const document = await vscode.workspace.openTextDocument(resourceUri);
      await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

      // Show the preview
      previewManager.showPreview(context, document);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('markdownPreview.open', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === 'markdown') {
        if (previewManager.hasPreviewPanel()) {
          previewManager.updatePreview(context, editor.document);
        } else {
          previewManager.showPreview(context, editor.document);
        }
      } else {
        vscode.window.showWarningMessage('Open a Markdown file to preview it.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('writerjetExtension.checkConfig', checkConfigFile)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('markdownPreview.show', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === 'markdown') {
        if (previewManager.hasPreviewPanel()) {
          previewManager.updatePreview(context, editor.document);
        } else {
          previewManager.showPreview(context, editor.document);
        }
      } else {
        vscode.window.showWarningMessage('Open a Markdown file to preview it.');
      }
    })
  );
}
