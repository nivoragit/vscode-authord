import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Initial state
let configExists = false;
// Getter function
export function getConfigExists(): boolean {
  return configExists;
}
// Setter function
export function setConfigExists(value: boolean): void {
  configExists = value;
  vscode.commands.executeCommand('setContext', 'writerjet.configExists', value);
}

// export async function checkConfigFile() {
//   const workspaceFolders = vscode.workspace.workspaceFolders;
//   if (!workspaceFolders) {
//     vscode.window.showErrorMessage('No workspace folder is open.');
//     return;
//   }

//   // const configFilePath = path.join(workspaceFolders[0].uri.fsPath, 'writerjet.config.json');
//   // const configExists = fs.existsSync(configFilePath);

//   // vscode.commands.executeCommand('setContext', 'writerjet.configExists', configExists);
  
// }