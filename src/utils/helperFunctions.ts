import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Topic, TocElement, TocTreeItem } from './types';

// Initial state
let _configExist = false;
let _authorFocus = false;

const configExistsEmitter = new vscode.EventEmitter<void>();
export const onConfigExists = configExistsEmitter.event;

// Getter function
export function configExist(): boolean {
  return _configExist;
}
// Setter function
export function setConfigExists(value: boolean): void {
  _configExist = value;
  vscode.commands.executeCommand('setContext', 'authord.configExists', value);
  if (value){
    configExistsEmitter.fire();
  }
}
// Getter function
export function authorFocus(): boolean {
  return _authorFocus;
}
// Setter function
export function setAuthorFocus(value: boolean): void {
  _authorFocus = value;
  
}

// Helper function to show the preview in column two
export async function showPreviewInColumnTwo() {
  const previewEditors = vscode.window.visibleTextEditors.filter(
    (editor) =>
      editor.document.uri.scheme === 'markdown-preview' &&
      editor.viewColumn === vscode.ViewColumn.Two
  );

  if (previewEditors.length === 0 && authorFocus()) {
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

// Helper function to focus the existing preview
export async function focusExistingPreview() {
  const previewEditor = vscode.window.visibleTextEditors.find(
    (editor) =>
      editor.document.uri.scheme === 'markdown-preview' &&
      editor.viewColumn === vscode.ViewColumn.Two
  );

  if (previewEditor) {
    await vscode.window.showTextDocument(previewEditor.document, vscode.ViewColumn.Two, false);
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
    await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');

  }
}


export function loadTopics(topicsPath: string): Topic[] {
  try {
    const markdownFiles: Topic[] = [];

    const traverseDirectory = (dirPath: string) => {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          traverseDirectory(fullPath); // Recursively explore subdirectories
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          markdownFiles.push({
            name: path.basename(entry.name),
            path: fullPath,
          });
        }
      }
    };
    traverseDirectory(topicsPath);
    return markdownFiles;
  } catch (error: any) {
    console.error(`Error loading topics: ${error.message}`);
    return [];
  }
}


export function parseTocElements(tocElements: TocElement[]): TocTreeItem[] {
  return tocElements.map(element => {
    const children = element.children ? parseTocElements(element.children) : [];
    return {
      id: element.id,
      title: element['toc-title'],
      topic: element.topic,
      sortChildren: element['sort-children'],
      children,
    };
  });
}


export function linkTopicsToToc(tocTree: TocTreeItem[], topics: Topic[]): void {
  tocTree.forEach(element => {
    if (element.topic) {
      const topic = topics.find(t => t.name === element.topic);
      if (topic) {
        element.filePath = topic.path;
      }
    }
    if (element.children) {
      linkTopicsToToc(element.children, topics);
    }
  });
}

export function sortTocElements(tocElements: TocTreeItem[]): void {
  tocElements.forEach(element => {
    if (element.sortChildren && element.children) {
      element.children.sort((a, b) => a.title.localeCompare(b.title) * (element.sortChildren === 'ascending' ? 1 : -1));
      sortTocElements(element.children);
    }
  });
}



