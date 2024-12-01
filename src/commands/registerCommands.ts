import * as vscode from 'vscode';
import { AuthordTreeDataProvider } from '../views/authordTreeDataProviderTreeDataProvider';
import {configExist, setAuthorFocus, showPreviewInColumnTwo, focusOrShowPreview } from '../utils/helperFunctions';

export function registerCommands(context: vscode.ExtensionContext) {
  const treeDataProvider = new AuthordTreeDataProvider();
  vscode.window.registerTreeDataProvider('authordExtensionView', treeDataProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand('authordExtension.openMarkdownFile', async (resourceUri: vscode.Uri) => {
      if (!configExist()) {
        return;
      }
      setAuthorFocus(true);

      // Open the markdown file in the first column
      const document = await vscode.workspace.openTextDocument(resourceUri);
      await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

      // Focus the existing preview or open it if it doesn't exist
      await focusOrShowPreview();

      setAuthorFocus(false);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownPreview.open', async () => {
      if (!configExist()) {
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

