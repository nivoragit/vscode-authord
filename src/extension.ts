import * as vscode from 'vscode';
import { registerCommands } from './commands/registerCommands';
import { SidebarProvider } from './views/sidebarView';
import { MarkdownFileProvider } from './views/markdownFileProvider';
import { WriterJetViewProvider } from './views/writerJetViewProvider';
import { getwJetFocus } from './utils/helperFunctions';

export function activate(context: vscode.ExtensionContext) {
  // Register commands
  registerCommands(context);

  // Get the workspace root
  const workspaceRoot = vscode.workspace.workspaceFolders
    ? vscode.workspace.workspaceFolders[0].uri.fsPath
    : undefined;

  // Register the WriterJet Documentation View
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      WriterJetViewProvider.viewType, // ID from package.json
      new WriterJetViewProvider(context, workspaceRoot)
    )
  );

  // Create and register the MarkdownFileProvider
  const markdownFileProvider = new MarkdownFileProvider(workspaceRoot);
  vscode.window.registerTreeDataProvider('writerjetMarkdownFilesView', markdownFileProvider);

  // Refresh the view when the workspace changes
  vscode.workspace.onDidChangeWorkspaceFolders(() => markdownFileProvider.refresh());
  vscode.workspace.onDidCreateFiles(() => markdownFileProvider.refresh());
  vscode.workspace.onDidDeleteFiles(() => markdownFileProvider.refresh());
  vscode.workspace.onDidRenameFiles(() => markdownFileProvider.refresh());

  // Initialize sidebar view
  const sidebarProvider = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('vs-code-sidebar', sidebarProvider)
  );

  // Listen for changes in the active editor
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (editor && editor.document.languageId === 'markdown') {
        // Open or update the preview in column two
        await showPreviewInColumnTwo();
      }
    })
  );

  // If a markdown file is already open, show the preview
  if (
    vscode.window.activeTextEditor &&
    vscode.window.activeTextEditor.document.languageId === 'markdown'
  ) {
    showPreviewInColumnTwo();
  }

  vscode.window.showInformationMessage('WriterJet Extension is now active!');

  // Return the extendMarkdownIt function
  return {
    extendMarkdownIt(md: any) {
      // Apply your custom markdown-it plugins or rules here
      // For example, adding emoji support:
      const emoji = require('markdown-it-katex');
      return md.use(emoji);
    },
  };
}

export function deactivate() {
  // Clean up resources if necessary
}

// Helper function to show the preview in column two
async function showPreviewInColumnTwo() {
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
