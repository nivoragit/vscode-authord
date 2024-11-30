import * as vscode from 'vscode';
import { processMarkdown } from '../utils/remarkProcessor';
import { getWebviewContent } from '../utils/webviewUtils';

export function showMarkdownPreview(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument
) {
  const panel = vscode.window.createWebviewPanel(
    'markdownPreview',
    'Markdown Preview',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(context.extensionPath)],
      // localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    }
  );

  updateWebviewContent(panel, document, context);

  const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(
    (e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebviewContent(panel, e.document, context);
      }
    }
  );

  panel.onDidDispose(() => {
    changeDocumentSubscription.dispose();
  }, null, context.subscriptions);
}

async function updateWebviewContent(
  panel: vscode.WebviewPanel,
  document: vscode.TextDocument,
  context: vscode.ExtensionContext
) {
  const markdownContent = document.getText();
  const processedContent = await processMarkdown(markdownContent);
  panel.webview.html = getWebviewContent(processedContent, panel, context);
}
