import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export async function checkConfigFile() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage('No workspace folder is open.');
    return;
  }

  const configFilePath = path.join(workspaceFolders[0].uri.fsPath, 'writerside.config.json');
  const configExists = fs.existsSync(configFilePath);

  vscode.commands.executeCommand('setContext', 'writerjet.configExists', configExists);

  if (!configExists) {
    vscode.window
      .showInformationMessage(
        'WriterJet configuration file is missing. Would you like to create it?',
        'Create File'
      )
      .then((selection) => {
        if (selection === 'Create File') {
          fs.writeFileSync(configFilePath, JSON.stringify({ settingOne: '', settingTwo: 0 }, null, 2));
          vscode.window.showInformationMessage('WriterJet configuration file created successfully!');
          vscode.commands.executeCommand('setContext', 'writerjet.configExists', true);
        }
      });
  }
  }