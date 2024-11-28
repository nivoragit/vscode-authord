import * as vscode from 'vscode';
import { registerCommands } from './commands/registerCommands.js';
import { SidebarProvider } from './views/sidebarView.js';
import { previewManager } from './views/previewManager.js';
import { MarkdownFileProvider } from './views/markdownFileProvider.js';
import { WriterJetViewProvider } from './views/writerJetViewProvider.js';
import { getConfigExists, getwJetFocus } from './utils/helperFunctions.js';



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

 
  // Shift focus back to editor before a new file opens
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async () => {
      const editor = vscode.window.visibleTextEditors.find(
        (ed) => ed.viewColumn === vscode.ViewColumn.One
      );

      if (editor) {
        // Shift focus to the editor in the first column
        await vscode.window.showTextDocument(editor.document, vscode.ViewColumn.One, false);
      }
    })
  );

  // Listen for changes in the active editor
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (getwJetFocus() && editor && editor.document.languageId === 'markdown') {
        if (previewManager.hasPreviewPanel()) {
          previewManager.updatePreview(context, editor.document);
        } else {
          previewManager.showPreview(context, editor.document);
        }
      }
    })
  );

  // Listen for changes in the document content
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (getwJetFocus() &&
        vscode.window.activeTextEditor &&
        event.document === vscode.window.activeTextEditor.document &&
        event.document.languageId === 'markdown'
      ) {
        previewManager.updatePreview(context, event.document);
      }
    })
  );

  // If a markdown file is already open, show the preview
  if (getwJetFocus() &&
    vscode.window.activeTextEditor &&
    vscode.window.activeTextEditor.document.languageId === 'markdown'
  ) {
    previewManager.showPreview(context, vscode.window.activeTextEditor.document);
  }

  vscode.window.showInformationMessage('WriterJet Extension is now active!');
}

export function deactivate() {
  // Clean up resources if necessary
}
