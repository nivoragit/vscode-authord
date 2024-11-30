import * as vscode from 'vscode';
import { WriterJetTreeDataProvider } from '../views/writerJetTreeDataProviderTreeDataProvider';
import { getConfigExists, setwJetFocus } from '../utils/helperFunctions';

export function registerCommands(context: vscode.ExtensionContext) {
  const treeDataProvider = new WriterJetTreeDataProvider();
  vscode.window.registerTreeDataProvider('writerjetExtensionView', treeDataProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'writerjetExtension.openMarkdownFile',
      async (resourceUri: vscode.Uri) => {
        if (!getConfigExists()) {
          return;
        }
        setwJetFocus(true);

        // Open the markdown file in the first column
        const document = await vscode.workspace.openTextDocument(resourceUri);
        await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

        // Show or update the preview in column two
        await showPreviewInColumnTwo();
        setwJetFocus(false);
      }
    )
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

// Helper function to show the preview in column two (same as in extension.ts)
async function showPreviewInColumnTwo() {
  // Check if a preview is already open in column two
  const previewEditor = vscode.window.visibleTextEditors.find(
    (editor) =>
      editor.document.uri.scheme === 'markdown-preview' &&
      editor.viewColumn === vscode.ViewColumn.Two
  );

  if (!previewEditor) {
    // Show the preview to the side (column two)
    await vscode.commands.executeCommand('markdown.showPreviewToSide');
  } else {
    // Focus on the existing preview editor
    await vscode.window.showTextDocument(previewEditor.document, vscode.ViewColumn.Two, false);
  }
}
