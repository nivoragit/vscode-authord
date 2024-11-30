import * as vscode from 'vscode';
import { registerCommands } from './commands/registerCommands';
import { SidebarProvider } from './views/sidebarView';
import { MarkdownFileProvider } from './views/markdownFileProvider';
import { WriterJetViewProvider } from './views/writerJetViewProvider';
import { focusExistingPreview, getwJetFocus, showPreviewInColumnTwo } from './utils/helperFunctions';

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

   // Listen for when the active editor changes
   context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (editor && editor.document.languageId === 'markdown') {
        // Focus the existing preview if it's open
        await focusExistingPreview();
      }
    })
  );


  // If a markdown file is already open, show the preview
  // if (
  //   vscode.window.activeTextEditor &&
  //   vscode.window.activeTextEditor.document.languageId === 'markdown'
  // ) {
  //   showPreviewInColumnTwo();
  // }

  vscode.window.showInformationMessage('WriterJet Extension is now active!');

  // Return the extendMarkdownIt function
  return {
    extendMarkdownIt(md: any) {
      // Apply your custom markdown-it plugins or rules here
      // For example, adding emoji support:
      // const emoji = require('markdown-it-plantuml');
      return md.use(require('markdown-it-plantuml'));
      // return md;
    },
  };
}

export function deactivate() {
  // Clean up resources if necessary
}

