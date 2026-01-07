// src/AuthordPreview.ts

import * as vscode from 'vscode';
import * as path from 'path';
import RenderService, { type PreviewRenderMode } from './services/RenderService';
import type { DocumentationManager } from './managers/DocumentationManager';

type PreviewContext = {
  documentManager?: DocumentationManager;
  renderMode: PreviewRenderMode;
};

export class AuthordPreview implements vscode.Disposable {
  private static currentPanel: AuthordPreview | undefined;
  private disposables: vscode.Disposable[] = [];
  private panel: vscode.WebviewPanel;
  private renderService: RenderService;
  private previewContext: PreviewContext;

  // Minimal doc cache to avoid re-processing on minor changes
  private docCache = new Map<string, { version: number; html: string }>();
  /**
   * Create or show the single custom preview panel
   */
  public static createOrShow(
    context: vscode.ExtensionContext,
    renderService: RenderService,
    previewContext: PreviewContext
  ): AuthordPreview {
    if (AuthordPreview.currentPanel) {
      AuthordPreview.currentPanel.updateContext(previewContext);
      AuthordPreview.currentPanel.panel.reveal(vscode.ViewColumn.Two);
      return AuthordPreview.currentPanel;
    }
    const panel = vscode.window.createWebviewPanel(
      'authordPreview',
      'Authord Preview',
      vscode.ViewColumn.Two,
      { enableScripts: true }
    );
    AuthordPreview.currentPanel = new AuthordPreview(panel, renderService, previewContext);
    return AuthordPreview.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    renderService: RenderService,
    previewContext: PreviewContext
  ) {
    this.panel = panel;
    this.renderService = renderService;
    this.previewContext = previewContext;

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

    const initialHtml = await this.renderService.renderDocument(doc, {
      documentManager: this.previewContext.documentManager,
      renderMode: this.previewContext.renderMode,
    });
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

  public updateContext(previewContext: PreviewContext): void {
    const shouldInvalidate =
      this.previewContext.documentManager !== previewContext.documentManager ||
      this.previewContext.renderMode !== previewContext.renderMode;
    this.previewContext = previewContext;
    if (shouldInvalidate) {
      this.docCache.clear();
    }
  }

  /**
   * Convert any local image paths (relative or absolute) into webview URIs so
   * images render properly inside the WebView.
   * This is the most efficient approach, since it simply rewrites image sources
   * in one pass, avoiding unnecessary transformations on valid remote or data URIs.
   */
  private fixImagePaths(html: string, docPath: string): string {
    const imageFolder = this.previewContext.documentManager?.getImagesDirectory();
    let out = html;
    out = this.rewriteAttachTokens(out, imageFolder);
    out = this.rewriteConfluenceImages(out, imageFolder);
    out = this.rewriteImgSrc(out, docPath);
    return out;
  }

  private rewriteAttachTokens(html: string, imageFolder?: string): string {
    if (!imageFolder) return html;
    const attachRegex = /@@ATTACH\|file=([^|@]+)(?:\|width=([^|@]+))?(?:\|height=([^|@]+))?@@/gi;
    return html.replace(attachRegex, (_match, file, width, height) => {
      const diskPath = path.join(imageFolder, file);
      const webviewUri = this.panel.webview.asWebviewUri(vscode.Uri.file(diskPath));
      const attrs: string[] = [];
      if (width) attrs.push(`width="${escapeAttr(String(width))}"`);
      if (height) attrs.push(`height="${escapeAttr(String(height))}"`);
      return `<img src="${webviewUri.toString()}"${attrs.length ? ` ${attrs.join(' ')}` : ''} />`;
    });
  }

  private rewriteConfluenceImages(html: string, imageFolder?: string): string {
    if (!imageFolder) return html;
    const acImageRegex = /<ac:image\b([^>]*)>([\s\S]*?)<\/ac:image>/gi;
    return html.replace(acImageRegex, (match, attrText, innerHtml) => {
      const filenameMatch = /<ri:attachment\b[^>]*ri:filename=["']([^"']+)["'][^>]*\/?>/i.exec(innerHtml);
      if (!filenameMatch) return match;

      const filename = filenameMatch[1];
      const widthMatch = /\bac:width=["']([^"']+)["']/.exec(attrText);
      const heightMatch = /\bac:height=["']([^"']+)["']/.exec(attrText);
      const diskPath = path.join(imageFolder, filename);
      const webviewUri = this.panel.webview.asWebviewUri(vscode.Uri.file(diskPath));

      const attrs: string[] = [];
      if (widthMatch?.[1]) attrs.push(`width="${escapeAttr(widthMatch[1])}"`);
      if (heightMatch?.[1]) attrs.push(`height="${escapeAttr(heightMatch[1])}"`);
      return `<img src="${webviewUri.toString()}"${attrs.length ? ` ${attrs.join(' ')}` : ''} />`;
    });
  }

  private rewriteImgSrc(html: string, docPath: string): string {
    const imageTagRegex = /<img\s+[^>]*src=["']([^"']+)["']/gi;
    return html.replace(imageTagRegex, (match, src) => {
      // Ignore remote, data, or already-sanitized webview URIs.
      if (/^(https?:|data:|vscode-resource:|vscode-webview:)/i.test(src)) {
        return match;
      }

      let diskPath = src;
      if (/^file:\/\//i.test(src)) {
        diskPath = vscode.Uri.parse(src).fsPath;
      } else if (!path.isAbsolute(src)) {
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

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
