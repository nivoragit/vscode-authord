import * as vscode from 'vscode';
import { InitializeExtension } from './initializeExtension';
// Initial state
export let configValid = false;
export let authorFocus = false;

export const configExistsEmitter = new vscode.EventEmitter<void>();
export const onConfigExists = configExistsEmitter.event;


// Setter function
export function setConfigValid(value: boolean){
  configValid = value;
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