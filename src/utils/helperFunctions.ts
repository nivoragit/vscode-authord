import * as vscode from 'vscode';
import * as path from 'path';
import { parseIhpFile } from '../parsers/ihpParser';
import { parseTreeFile } from '../parsers/treeParser';
import { Config } from './types';
import { v4 as uuidv4 } from 'uuid';
import { Token } from 'markdown-it';
import { Authord } from '../authordExtension';
import { AbstractConfigManager } from '../config/abstractConfigManager';


// Initial state
export let configExists = true;
export const configFiles = ['authord.config.json', 'writerside.cfg'];

export function generateUniqueId(): string {
  return uuidv4();
}


export async function generateJson(ihpFilePath: string): Promise<Config> {
  const { topics, images, instanceFiles } = await parseIhpFile(ihpFilePath);

  const instances = [];
  for (const file of instanceFiles) {
    const filePath = path.resolve(path.dirname(ihpFilePath), file);
    const instanceData = await parseTreeFile(filePath);
    instances.push(instanceData);
  }

  return {
    schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Authord Settings',
    type: 'object',
    topics,
    images,
    instances
  } as any;
}

// Setter function
export function setConfigExists(value: boolean): void {
  configExists = value;
  vscode.commands.executeCommand('setContext', 'authord.configExists', value);
}

// Helper function to show the preview in column two
export async function showPreviewInColumnTwo() {
  const previewEditors = vscode.window.visibleTextEditors.filter(
    (editor) =>
      editor.document.uri.scheme === 'markdown-preview' &&
      editor.viewColumn === vscode.ViewColumn.Two
  );

  if (previewEditors.length === 0) {
    // Show the built-in markdown preview to the side (column two)
    await vscode.commands.executeCommand('markdown.showPreviewToSide');
  } else {
    // Update the existing preview
    await vscode.commands.executeCommand('markdown.updatePreview');
  }

  // Ensure that only one preview is open
  await closeExtraPreviews();
}



// Helper function to close any extra preview panes
async function closeExtraPreviews() {
  const previewEditors = vscode.window.visibleTextEditors.filter(
    (editor) => editor.document.uri.scheme === 'markdown-preview'
  );

  if (previewEditors.length > 1) {
    // Close all preview editors except the one in column two
    for (const editor of previewEditors) {
      if (editor.viewColumn !== vscode.ViewColumn.Two) {
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor', editor);
      }
    }
  }
}


// Helper function to focus or show the preview
export async function focusOrShowPreview() {
  const previewEditor = vscode.window.visibleTextEditors.find(
    (editor) =>
      editor.document.uri.scheme === 'markdown-preview' &&
      editor.viewColumn === vscode.ViewColumn.Two
  );

  if (previewEditor) {
    // Focus on the existing preview editor
    await vscode.window.showTextDocument(previewEditor.document, vscode.ViewColumn.Two, false);
  } else {
    // Show the preview to the side (column two)
    await vscode.commands.executeCommand('markdown.showPreviewToSide');
  }
  await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
}

// 1) Helper to handle standard Markdown images: ![Alt text](path)
export function createCustomImageRenderer(
  defaultRender: (
    tokens: Token[],
    idx: number,
    options: any,
    env: any,
    self: any
  ) => string,
  configManager: AbstractConfigManager | undefined
) {
  return function (
    tokens: Token[],
    idx: number,
    options: any,
    env: any,
    self: any
  ) {
    if(!configManager){
      return defaultRender(tokens, idx, options, env, self);
    }
    const token = tokens[idx];
    const srcIndex = token.attrIndex('src');
    const currentDocumentPath = env.currentDocument.path;
    const imageFolder = path.basename(configManager.getImageDir()); 
    const topicsFolder = path.basename(configManager.getTopicsDir());
    // Prefix markdown image paths if missing "images/"
    // todo topics hard coded
    if (currentDocumentPath.includes(topicsFolder) && srcIndex >= 0) {
      const srcValue = token.attrs![srcIndex][1];
      if (
        srcValue &&
        !srcValue.startsWith(`../${imageFolder}/`) &&
        !srcValue.startsWith('http') // skip web images
      ) {
        token.attrs![srcIndex][1] = `../${imageFolder}/` + srcValue;
      }
    }

    return defaultRender(tokens, idx, options, env, self);
  };
}

// 2) Helper to handle HTML-based images: <img src="..." width=".." height="..">
export function createCustomHtmlRenderer(
  defaultRender: (
    tokens: Token[],
    idx: number,
    options: any,
    env: any,
    self: any
  ) => string,
  configManager: AbstractConfigManager | undefined
) {
  return function (
    tokens: Token[],
    idx: number,
    options: any,
    env: any,
    self: any
  ) {
    if(!configManager){
      return defaultRender(tokens, idx, options, env, self);
    }
    const currentDocumentPath = env.currentDocument.path;
    let content = tokens[idx].content;
    const imageFolder = path.basename(configManager.getImageDir()); 
    const topicsFolder = path.basename(configManager.getTopicsDir()); 
    // Look for <img ...> tags inside HTML blocks or inline HTML
    // E.g., <img src="images/example.png" alt="Example" width="300">
    // We'll prefix any src that doesn't start with http or 'images/'.
    content = content.replace(
      /<img\s+([^>]*src\s*=\s*["'])([^"']+)(["'][^>]*)>/gi,
      (match, beforeSrc, srcValue, afterSrc) => {
        // Only prefix if missing 'images/' and not a URL
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

    // You can handle <a><img ...></a> or other combos similarly if needed.

    // Update token’s content
    tokens[idx].content = content;
    return defaultRender(tokens, idx, options, env, self);
  };
}