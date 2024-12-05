import * as vscode from 'vscode';
import { AuthordViewProvider } from './views/authordViewProvider';
import { configExistsEmitter, checkConfigFiles, configExists, focusOrShowPreview, onConfigExists, setAuthorFocus, setConfigExists, generateJson} from './utils/helperFunctions';
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
      setConfigExists(true);

    }catch (error: any) {
      vscode.window.showErrorMessage(`Failed to reload configuration: ${error.message}`);
      vscode.commands.executeCommand('setContext', 'authord.configExists', false);

     
    }
  });
  context.subscriptions.push(disposable);
  if(checkConfigFiles(workspaceRoot)){ configExistsEmitter.fire();}
  
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
      if (!configExists) {
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

// import * as fs from 'fs';
// import { generateJson } from './utils/helperFunctions';

// const x = '/Users/madushika/WritersideProjects/untitled/Writerside/authord.config.json';
// const y = '/Users/madushika/WritersideProjects/untitled/Writerside/writerside.cfg';
// const convertedConfig = (async () => { return await generateJson(y); })();
// fs.writeFileSync(x, JSON.stringify(convertedConfig));