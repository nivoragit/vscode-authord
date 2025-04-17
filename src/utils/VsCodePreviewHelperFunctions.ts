/* eslint-disable import/no-unresolved */
import * as vscode from 'vscode';
import * as path from 'path';
import { Token } from 'markdown-it';
import { DocumentationManager } from '../managers/DocumentationManager';


/**
 * Either focuses an existing preview in column two, or opens a new one there.
 */
export async function focusOrShowPreview(): Promise<void> {
  const previewEditor = vscode.window.visibleTextEditors.find(
    (editor) =>
      editor.document.uri.scheme === 'markdown-preview' &&
      editor.viewColumn === vscode.ViewColumn.Two
  );

  if (previewEditor) {
    // Focus on the existing preview editor
    await vscode.window.showTextDocument(previewEditor.document, vscode.ViewColumn.Two, false);
  } else {
    // Open and Show the preview to the side (column two)
    await vscode.commands.executeCommand('markdown.showPreviewToSide');
  }
  await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
}

/**
 * Custom renderer for standard Markdown images: ![Alt text](path)
 */
export function createCustomImageRenderer(
  defaultRender: (
    tokens: Token[],
    idx: number,
    options: any,
    env: any,
    self: any
  ) => string,
  documentManager: DocumentationManager | undefined
) {
  // Name the returned function to fix "Unexpected unnamed function" (func-names).
  return function customImageRenderer(
    tokens: Token[],
    idx: number,
    options: any,
    env: any,
    self: any
  ) {
    if (!documentManager) {
      return defaultRender(tokens, idx, options, env, self);
    }

    const token = tokens[idx];
    const srcIndex = token.attrIndex('src');
    const { path: currentDocumentPath } = env.currentDocument;
    const imageFolder = path.basename(documentManager.getImagesDirectory());
    const topicsFolder = path.basename(documentManager.getTopicsDirectory());

    if (currentDocumentPath.includes(topicsFolder) && srcIndex >= 0) {
      const srcValue = token.attrs![srcIndex][1];
      if (
        srcValue &&
        !srcValue.startsWith(`../${imageFolder}/`) &&
        !srcValue.startsWith('http') // skip web images
      ) {
        // Use template string instead of string concatenation (prefer-template)
        token.attrs![srcIndex][1] = `../${imageFolder}/${srcValue}`;
      }
    }

    return defaultRender(tokens, idx, options, env, self);
  };
}

/**
 * Custom renderer for HTML-based images: <img src="..." width=".." height="..">
 */
export function createCustomHtmlRenderer(
  defaultRender: (
    tokens: Token[],
    idx: number,
    options: any,
    env: any,
    self: any
  ) => string,
  documentManager: DocumentationManager | undefined
) {
  // Name the returned function to fix "Unexpected unnamed function" (func-names).
  return function customHtmlRenderer(
    tokens: Token[],
    idx: number,
    options: any,
    env: any,
    self: any
  ) {
    if (!documentManager) {
      return defaultRender(tokens, idx, options, env, self);
    }

    const { path: currentDocumentPath } = env.currentDocument;
    const imageFolder = path.basename(documentManager.getImagesDirectory());
    const topicsFolder = path.basename(documentManager.getTopicsDirectory());

    // Use object destructuring to satisfy "prefer-destructuring"
    const { content: originalContent } = tokens[idx];
    let content = originalContent;

    // Look for <img ...> tags inside HTML blocks or inline HTML
    content = content.replace(
      /<img\s+([^>]*src\s*=\s*["'])([^"']+)(["'][^>]*)>/gi,
      (match, beforeSrc, srcValue, afterSrc) => {
        if (
          currentDocumentPath.includes(topicsFolder) &&
          srcValue &&
          !srcValue.startsWith(`../${imageFolder}/`) &&
          !/^https?:\/\//i.test(srcValue)
        ) {
          return `<img ${beforeSrc}../${imageFolder}/${srcValue}${afterSrc}>`;
        }
        return match;
      }
    );
    tokens[idx].content = content;

    return defaultRender(tokens, idx, options, env, self);
  };
}