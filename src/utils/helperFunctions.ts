import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export async function checkConfigFile() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
  
    if (!workspaceFolders) {
      vscode.window.showErrorMessage('No workspace folder is open.');
      return;
    }
  
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const configFilePath = path.join(workspaceRoot, 'config.cfg');
  
    if (fs.existsSync(configFilePath)) {
      vscode.window.showInformationMessage('Config file found.');
    } else {
      const createConfig = await vscode.window.showInformationMessage(
        'Config file not found. Do you want to create one?',
        'Yes',
        'No'
      );
      if (createConfig === 'Yes') {
        fs.writeFileSync(configFilePath, '');
        vscode.window.showInformationMessage('Config file created.');
      }
    }
  }