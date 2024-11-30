import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Initial state
let configExists = false;
let wJetFocus = false;
// Getter function
export function getConfigExists(): boolean {
  return configExists;
}
// Setter function
export function setConfigExists(value: boolean): void {
  configExists = value;
  vscode.commands.executeCommand('setContext', 'authord.configExists', value);
}
// Getter function
export function getwJetFocus(): boolean {
  return wJetFocus;
}
// Setter function
export function setwJetFocus(value: boolean): void {
  wJetFocus = value;
  
}

// Helper function to show the preview in column two
export async function showPreviewInColumnTwo() {
  const previewEditors = vscode.window.visibleTextEditors.filter(
    (editor) =>
      editor.document.uri.scheme === 'markdown-preview' &&
      editor.viewColumn === vscode.ViewColumn.Two
  );

  if (previewEditors.length === 0 && getwJetFocus()) {
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
  }
}
