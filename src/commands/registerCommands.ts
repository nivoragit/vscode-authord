import * as vscode from 'vscode';
import { WriterJetTreeDataProvider } from '../views/writerJetTreeDataProviderTreeDataProvider';
import {getwJetFocus, getConfigExists, setwJetFocus, showPreviewInColumnTwo, focusOrShowPreview } from '../utils/helperFunctions';

export function registerCommands(context: vscode.ExtensionContext) {
  const treeDataProvider = new WriterJetTreeDataProvider();
  vscode.window.registerTreeDataProvider('writerjetExtensionView', treeDataProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand('writerjetExtension.openMarkdownFile', async (resourceUri: vscode.Uri) => {
      if (!getConfigExists()) {
        return;
      }
      setwJetFocus(true);

      // Open the markdown file in the first column
      const document = await vscode.workspace.openTextDocument(resourceUri);
      await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

      // Focus the existing preview or open it if it doesn't exist
      await focusOrShowPreview();

      setwJetFocus(false);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownPreview.open', async () => {
      if (!getConfigExists()) {
        return;
      }
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === 'markdown') {
        // Show or update the preview in column two
        await showPreviewInColumnTwo();
      } else {
        vscode.window.showWarningMessage('Open a Markdown file to preview it.');
      }
    })
  );
}

