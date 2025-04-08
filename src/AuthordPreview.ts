// src/AuthordPreview.ts

import * as vscode from 'vscode';
import * as path from 'path';
import { renderContent } from './utils/remarkRenderer';

export class AuthordPreview implements vscode.Disposable {
  private static currentPanel: AuthordPreview | undefined;
  private disposables: vscode.Disposable[] = [];
  private panel: vscode.WebviewPanel;

  // Minimal doc cache to avoid re-processing on minor changes
  private docCache = new Map<string, { version: number; html: string }>();
  private static imageFolder: string | undefined;
  private static docPath: string | undefined;

  /**
   * Create or show the single custom preview panel
   */
  public static createOrShow(context: vscode.ExtensionContext,imageFolderPath: string | undefined, docPath: string | undefined): AuthordPreview {
    if (AuthordPreview.currentPanel) {
      AuthordPreview.currentPanel.panel.reveal(vscode.ViewColumn.Two);
      return AuthordPreview.currentPanel;
    }
    this.imageFolder = imageFolderPath;
    this.docPath = docPath;
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
          // vscode.commands.executeCommand('authordExtension.onPreviewScrolled', msg.line);
        }
      },
      null,
      this.disposables
    );
  }

  /**
   * Re-renders or updates the preview for the given document.
   * This now also handles local image paths by converting them into webview-safe URIs.
   */
  public async update(doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    const cached = this.docCache.get(key);
    if (cached && cached.version === doc.version) {
      this.panel.webview.html = cached.html;
      return;
    }

    const markdown = doc.getText();
    const initialHtml = await renderContent(markdown,AuthordPreview.imageFolder,AuthordPreview.docPath);
    const finalHtml = this.fixImagePaths(initialHtml, doc.uri.fsPath);

    this.docCache.set(key, { version: doc.version, html: finalHtml });
    this.panel.webview.html = finalHtml;
    // Force re-gather lines after content update
    this.panel.webview.postMessage({ command: 'refreshLines' });
  }

  /**
   * Let the extension post messages to the preview (Editor -> Preview).
   */
  public postMessage(msg: any) {
    this.panel.webview.postMessage(msg);
  }

  /**
   * Convert any local image paths (relative or absolute) into webview URIs so
   * images render properly inside the WebView.
   * This is the most efficient approach, since it simply rewrites image sources
   * in one pass, avoiding unnecessary transformations on valid remote or data URIs.
   */
  private fixImagePaths(html: string, docPath: string): string {
    const imageTagRegex = /<img\s+[^>]*src=["']([^"']+)["']/gi;
    return html.replace(imageTagRegex, (match, src) => {
      // Ignore data URLs or remote URLs
      if (/^https?:\/\//.test(src) || /^data:/.test(src)) {
        return match; // No change
      }

      // Resolve absolute or relative path
      let diskPath = src;
      if (!path.isAbsolute(src)) {
        diskPath = path.join(path.dirname(docPath), src);
      }

      const webviewUri = this.panel.webview.asWebviewUri(vscode.Uri.file(diskPath));
      return match.replace(src, webviewUri.toString());
    });
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
