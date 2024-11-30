import * as vscode from 'vscode';

export function getWebviewContent(body: string, panel: vscode.WebviewPanel, context: vscode.ExtensionContext): string {
  const stylesPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'styles.css');
  const stylesUri = panel.webview.asWebviewUri(stylesPath);

  const scriptPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'script.js');
  const scriptUri = panel.webview.asWebviewUri(scriptPath);
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Markdown Preview</title>
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${panel.webview.cspSource} 'unsafe-inline'; script-src ${panel.webview.cspSource};"
    />
    
    <link href="${stylesUri}" rel="stylesheet" />
    <script src="${scriptUri}"></script>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; }
      .highlight { background-color: yellow; }
    </style>

  </head>
  <body>
    ${body}
  </body>
  </html>`;
}
