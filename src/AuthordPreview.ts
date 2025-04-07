// src/AuthordPreview.ts
import * as vscode from 'vscode';
import { renderContent } from './utils/remarkRenderer';

export class AuthordPreview implements vscode.Disposable {
  private static currentPanel: AuthordPreview | undefined;
  private disposables: vscode.Disposable[] = [];
  private panel: vscode.WebviewPanel;
  
  // Minimal doc cache to avoid re-processing on minor changes
  private docCache = new Map<string, { version: number; html: string }>();

  /**
   * Create or show the single custom preview panel
   */
  public static createOrShow(context: vscode.ExtensionContext): AuthordPreview {
    if (AuthordPreview.currentPanel) {
      AuthordPreview.currentPanel.panel.reveal(vscode.ViewColumn.Two);
      return AuthordPreview.currentPanel;
    }
    const panel = vscode.window.createWebviewPanel(
      'authordPreview',
      'Authord Preview',
      vscode.ViewColumn.Two,
      { enableScripts: true }
    );
    AuthordPreview.currentPanel = new AuthordPreview(panel);
    return AuthordPreview.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;

    // Dispose resources when the panel is closed
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Listen for messages from the preview (two-way sync: preview -> extension)
    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg.command === 'previewScrolled') {
          // e.g. { command: 'previewScrolled', line: 14.3 }
          // Forward this to your extension so you can call `editor.revealRange` if desired
          vscode.commands.executeCommand('authordExtension.onPreviewScrolled', msg.line);
        }
      },
      null,
      this.disposables
    );
  }

  /**
   * Re-renders or updates the preview for the given document.
   */
  public async update(doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    const cached = this.docCache.get(key);

    if (cached && cached.version === doc.version) {
      this.panel.webview.html = cached.html; 
      return;
    }

    // Otherwise re-render
    const markdown = doc.getText();
    const html = await renderContent(markdown);

    this.docCache.set(key, { version: doc.version, html });
    this.panel.webview.html = html;
  }

  /**
   * Let the extension post messages to the preview (Editor -> Preview).
   */
  public postMessage(msg: any) {
    this.panel.webview.postMessage(msg);
  }

  /**
   * Dispose the panel and cleanup
   */
  public dispose() {
    AuthordPreview.currentPanel = undefined;
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) {
        d.dispose();
      }
    }
    this.panel.dispose();
  }
}
