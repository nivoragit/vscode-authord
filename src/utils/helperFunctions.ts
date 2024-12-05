import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseIhpFile } from '../parsers/ihpParser';
import { parseTreeFile } from '../parsers/treeParser';
import { Config } from './types';
import { log } from './logger';
import { writeFile } from './fileUtils';

// Initial state
export let configExists = false;
export let authorFocus = false;
export const configFiles = ['authord.config.json', 'writerside.cfg'];

export const configExistsEmitter = new vscode.EventEmitter<void>();
export const onConfigExists = configExistsEmitter.event;
let workspaceRoot = "";

export async function checkConfigFiles(root?: string) {
  if (root) { workspaceRoot = root; }
  for (const fileName of configFiles) {
    const filePath = path.join(workspaceRoot, fileName);
    if (fs.existsSync(filePath)) {
      if (fileName === configFiles[1]) {
        try {
          const convertedConfig =  await generateJson(filePath);
          await writeFile(path.join(workspaceRoot, configFiles[0]), JSON.stringify(convertedConfig));          
        } catch (error: any) {
          vscode.window.showErrorMessage(`Error reading authord.json: ${error.message}`);
          setConfigExists(false);
          return false;
        }
      }
      // setConfigValid(true); // cosider with writer.cfg
      return true;
    }
  }
  setConfigExists(false);
  return false;
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
export function setConfigExists(value: boolean) {
  configExists = value;
  vscode.commands.executeCommand('setContext', 'authord.configExists', value);
}

// Setter function
export function setAuthorFocus(value: boolean): void {
  authorFocus = value;

}
// Helper function to show the preview in column two
export async function showPreviewInColumnTwo() {
  const previewEditors = vscode.window.visibleTextEditors.filter(
    (editor) =>
      editor.document.uri.scheme === 'markdown-preview' &&
      editor.viewColumn === vscode.ViewColumn.Two
  );

  if (previewEditors.length === 0 && authorFocus) {
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