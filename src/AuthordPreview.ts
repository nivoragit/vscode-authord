// src/AuthordPreview.ts
import * as vscode from 'vscode';
import { renderContent } from './utils/remarkRenderer';

export class AuthordPreview implements vscode.Disposable {
  private static currentPanel: AuthordPreview | undefined;
  private disposables: vscode.Disposable[] = [];

  // The actual WebviewPanel
  private panel: vscode.WebviewPanel;

  // Simple doc cache: doc URI -> { version, html }
  private docCache = new Map<string, { version: number; html: string }>();

  /**
   * Create or show the single preview panel.
   * If it already exists, reveal it.
   */
  public static createOrShow(context: vscode.ExtensionContext): AuthordPreview {
    // If the panel already exists, reveal it
    if (AuthordPreview.currentPanel) {
      AuthordPreview.currentPanel.panel.reveal(vscode.ViewColumn.Two);
      return AuthordPreview.currentPanel;
    }

    // Otherwise, create a new one
    const panel = vscode.window.createWebviewPanel(
      'authordPreview',
      'Authord Preview',
      vscode.ViewColumn.Two,
      {
        enableScripts: true, // needed if you want scroll sync or message passing
      }
    );

    AuthordPreview.currentPanel = new AuthordPreview(panel, context);
    return AuthordPreview.currentPanel;
  }

  /**
   * The constructor is private because we only create via .createOrShow()
   */
  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;

    // Clean up when panel is disposed
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Handle messages from the webview if you want 2-way sync
    this.panel.webview.onDidReceiveMessage(
      (message) => {
        // Example:
        // if (message.command === 'scrollToLine') { ... }
      },
      null,
      this.disposables
    );
  }

  /**
   * Update the preview for the given document
   */
  public async update(document: vscode.TextDocument) {
    const key = document.uri.toString();
    const cached = this.docCache.get(key);

    // If doc version hasn't changed, reuse cached HTML
    if (cached && cached.version === document.version) {
      this.panel.webview.html = this.wrapHtml(cached.html);
      return;
    }

    // Otherwise, parse fresh
    const markdown = document.getText();
    const html = await renderContent(markdown);

    // Cache the result
    this.docCache.set(key, { version: document.version, html });

    // Update webview
    this.panel.webview.html = this.wrapHtml(html);
  }

  /**
   * Basic HTML wrapper to include your theming or styles
   */
  private wrapHtml(body: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body {
      color: var(--vscode-editor-foreground);
      background-color: var(--vscode-editor-background);
      font-family: var(--vscode-editor-font-family);
      margin: 0;
      padding: 1rem;
    }
    /* Additional styling, code block theming, etc. can go here */
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
  }

  /**
   * Dispose resources
   */
  public dispose() {
    AuthordPreview.currentPanel = undefined;

    // Dispose all subscriptions
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      disposable && disposable.dispose();
    }

    // Dispose the panel itself
    this.panel.dispose();
  }
}
