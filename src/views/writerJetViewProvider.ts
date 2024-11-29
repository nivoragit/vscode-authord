import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class WriterJetViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'writerjetDocumentationView'; // Match the ID from package.json
  private _view?: vscode.WebviewView;

  constructor(private context: vscode.ExtensionContext, private workspaceRoot: string | undefined) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    this.updateContent();

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.command === 'createConfigFile') {
        await this.createConfigFile();
        this.updateContent(); // Refresh the view after creating the file
        vscode.commands.executeCommand('setContext', 'writerjet.configExists', true);
      }
    });
  }

  private async createConfigFile() {
    if (!this.workspaceRoot) {
      vscode.window.showErrorMessage('No workspace folder is open.');
      return;
    }

    const configFilePath = path.join(this.workspaceRoot, 'writerjet.config.json');
    if (!fs.existsSync(configFilePath)) {
      fs.writeFileSync(configFilePath, JSON.stringify({ settingOne: '', settingTwo: 0 }, null, 2));
      vscode.window.showInformationMessage('WriterJet configuration file created successfully!');
    } else {
      vscode.window.showWarningMessage('WriterJet configuration file already exists.');
    }
  }

  private updateContent() {
    if (!this._view) {
      return;
    }

    const configExists = this.checkConfigFile();
    const webview = this._view.webview;

    if (!configExists) {
      // Show "file missing" view with a button
      webview.html = this.getMissingConfigHtml();
    } else {
      // Show normal content
      webview.html = this.getNormalViewHtml();
    }
  }

  private checkConfigFile(): boolean {
    if (!this.workspaceRoot) {
      return false;
    }

    const configFilePath = path.join(this.workspaceRoot, 'writerjet.config.json');
    return fs.existsSync(configFilePath);
  }

  private getMissingConfigHtml(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WriterJet</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 2rem;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
          }
          h2 {
            font-size: 2rem;
            text-align: center;
            margin-bottom: 1rem;
          }
          p {
            font-size: 1.2rem;
            text-align: center;
            margin-bottom: 2rem;
          }
          button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 0.8rem 1.5rem;
            font-size: 1rem;
            cursor: pointer;
            border-radius: 5px;
            transition: background-color 0.3s ease;
          }
          button:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
          @media (max-width: 600px) {
            h2 {
              font-size: 1.5rem;
            }
            p {
              font-size: 1rem;
            }
            button {
              font-size: 0.9rem;
              padding: 0.6rem 1rem;
            }
          }
        </style>
      </head>
      <body>
        <h2>WriterJet configuration file is missing</h2>
        <p>Would you like to create it?</p>
        <button onclick="createConfig()">Create Configuration File</button>
        <script>
          const vscode = acquireVsCodeApi();
          function createConfig() {
            vscode.postMessage({ command: 'createConfigFile' });
          }
        </script>
      </body>
      </html>
    `;
  }

private getNormalViewHtml(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WriterJet</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 2rem;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
          }
          h2 {
            font-size: 2rem;
            text-align: center;
            margin-bottom: 1rem;
          }
          p {
            font-size: 1.2rem;
            text-align: center;
            margin-bottom: 2rem;
          }
          @media (max-width: 600px) {
            h2 {
              font-size: 1.5rem;
            }
            p {
              font-size: 1rem;
            }
          }
        </style>
      </head>
      <body>
        <h2>WriterJet Configuration</h2>
        <p>Your WriterJet configuration file is set up and ready to use.</p>
      </body>
      </html>
    `;
  }

}
