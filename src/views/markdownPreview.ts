import * as vscode from 'vscode';
import { processMarkdown } from '../utils/remarkProcessor.js';
import { getWebviewContent } from '../utils/webviewUtils.js';

export function showMarkdownPreview(context: vscode.ExtensionContext, document: vscode.TextDocument) {
  const panel = vscode.window.createWebviewPanel(
    'markdownPreview',
    'Markdown Preview',
    vscode.ViewColumn.Two,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(context.extensionPath)],
    }
  );

  // Render the initial content
  updateWebviewContent(panel, document, context);

  // Update the content when the document changes
  const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.uri.toString() === document.uri.toString()) {
      updateWebviewContent(panel, e.document, context);
    }
  });

  // Clean up when the panel is disposed
  panel.onDidDispose(() => {
    changeDocumentSubscription.dispose();
  }, null, context.subscriptions);
}

async function updateWebviewContent(panel: vscode.WebviewPanel, document: vscode.TextDocument, context: vscode.ExtensionContext) {
  const markdownContent = document.getText();

  // Process the Markdown content
  const processedContent = await processMarkdown(markdownContent);

  // Update the webview
  panel.webview.html = getWebviewContent(processedContent, panel, context);
}
