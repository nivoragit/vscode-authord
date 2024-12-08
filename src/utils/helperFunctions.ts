import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseIhpFile } from '../parsers/ihpParser';
import { parseTreeFile } from '../parsers/treeParser';
import { Config } from './types';
import { writeFile } from './fileUtils';
import { v4 as uuidv4 } from 'uuid';

// Initial state
export let configExists = true;
export const configFiles = ['authord.config.json', 'writerside.cfg'];

let workspaceRoot = "";

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
export function setConfigExists(value: boolean): void{
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