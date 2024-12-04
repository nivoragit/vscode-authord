import * as vscode from 'vscode';
import { AuthordViewProvider } from './views/authordViewProvider';
import { configValid, focusOrShowPreview, onConfigExists, setAuthorFocus, setConfigValid} from './utils/helperFunctions';
import { InitializeExtension } from './utils/initializeExtension';

export let initializer: InitializeExtension | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Get the workspace root
  if (!vscode.workspace.workspaceFolders) { return; }
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

  initializer = new InitializeExtension(context, workspaceRoot);
  const disposable = onConfigExists(async () => {
    try{
      if(initializer){
        initializer.initialize();
      }
      disposable.dispose(); // Clean up the event listener after initialization
      setConfigValid(true);

    }catch (error: any) {
      vscode.window.showErrorMessage(`Failed to reload configuration: ${error.message}`);
      setConfigValid(false);

     
    }
  });

  // Listen for when the active editor changes
  // context.subscriptions.push(
  //   vscode.window.onDidChangeActiveTextEditor(async (editor) => {
  //     if (editor && editor.document.languageId === 'markdown') {
  //       // Focus the existing preview if it's open
  //       await focusExistingPreview();
  //     }
  //   })
  // );

  // Register the Authord Documentation View
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AuthordViewProvider.viewType, // ID from package.json
      new AuthordViewProvider(context, workspaceRoot)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('authordExtension.openMarkdownFile', async (resourceUri: vscode.Uri) => {
      if (!configValid) {
        return;
      }
      setAuthorFocus(true);

      // Open the markdown file in the first column
      const document = await vscode.workspace.openTextDocument(resourceUri);
      await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

      // Focus the existing preview or open it if it doesn't exist
      await focusOrShowPreview();
      setAuthorFocus(false);
    })
  );

  context.subscriptions.push(disposable);
  
// Return the extendMarkdownIt function
return {
  extendMarkdownIt(md: any) {
    // Apply your custom markdown-it plugins or rules here
    // For example, adding PlantUML support:
    return md.use(require('markdown-it-plantuml'));
  },
};
  
}

export function deactivate() {
  if (initializer) {
    initializer.dispose();
  }
}