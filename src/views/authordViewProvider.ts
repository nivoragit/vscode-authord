// import * as vscode from 'vscode';
// import * as fs from 'fs';
// import * as path from 'path';
// import { configExists, configFiles } from '../utils/helperFunctions';

// // todo rename this
// export class AuthordViewProvider implements vscode.WebviewViewProvider {
//   public static readonly viewType = 'authordDocumentationView';
//   private _view?: vscode.WebviewView;

//   constructor(private context: vscode.ExtensionContext, private workspaceRoot: string) {}

//   resolveWebviewView(webviewView: vscode.WebviewView): void {
//     this._view = webviewView;

//     webviewView.webview.options = {
//       enableScripts: true,
//     };

//     this.updateContent();

//     // Handle messages from the webview
//     webviewView.webview.onDidReceiveMessage(async (message) => {
//       if (message.command === 'createConfigFile') {
//         await this.createConfigFile();
//         await this.updateContent(); // Refresh the view after creating the file

//       }
//     });
//   }

//   private async createConfigFile() {
//     if (!this.workspaceRoot) {
//       vscode.window.showErrorMessage('No workspace folder is open.');
//       return;
//     }

//     const configFile = path.join(this.workspaceRoot, configFiles[0]);
//     if (!fs.existsSync(configFile)) {
//       fs.writeFileSync(configFile, JSON.stringify(
//         {
//           "schema": "https://json-schema.org/draft/2020-12/schema",
//           "title": "Authord Settings",
//           "type": "object",
//           "topics": {
//             "dir": "topics"
//           },
//           "images": {
//             "dir": "images",
//             "version": "1.0",
//             "web-path": "images"
//           },
//           "instances": []
//         }
//         ,
//         null,
//         2
//       ));
//       vscode.window.showInformationMessage('Authord configuration file created successfully!');
//     } else {
//       vscode.window.showWarningMessage('Authord configuration file already exists.');
//     }
//   }

//   private async updateContent() {
//     if (!this._view) {
//       return;
//     }

    
//     const webview = this._view.webview;

//     if (!configExists) {
//       // Show "file missing" view with a button
//       webview.html = this.getMissingConfigHtml();
//     } else {
//       // Show normal content
//       webview.html = this.getNormalViewHtml();
//     }
//   }





//   private getMissingConfigHtml(): string {
//     return `
//       <!DOCTYPE html>
//       <html lang="en">
//       <head>
//         <meta charset="UTF-8">
//         <meta name="viewport" content="width=device-width, initial-scale=1.0">
//         <title>Authord</title>
//         <style>
//           body {
//             font-family: Arial, sans-serif;
//             margin: 0;webviewView.webview.onDidReceiveMessage
//             padding: 2rem;
//             box-sizing: border-box;
//             display: flex;
//             flex-direction: column;
//             align-items: center;
//             justify-content: center;
//             height: 100vh;
//             background-color: var(--vscode-editor-background);
//             color: var(--vscode-editor-foreground);
//           }
//           h2 {
//             font-size: 2rem;
//             text-align: center;
//             margin-bottom: 1rem;
//           }
//           p {
//             font-size: 1.2rem;
//             text-align: center;
//             margin-bottom: 2rem;
//           }
//           button {
//             background-color: var(--vscode-button-background);
//             color: var(--vscode-button-foreground);
//             border: none;
//             padding: 0.8rem 1.5rem;
//             font-size: 1rem;
//             cursor: pointer;
//             border-radius: 5px;
//             transition: background-color 0.3s ease;
//           }
//           button:hover {
//             background-color: var(--vscode-button-hoverBackground);
//           }
//           @media (max-width: 600px) {
//             h2 {
//               font-size: 1.5rem;
//             }
//             p {
//               font-size: 1rem;
//             }
//             button {
//               font-size: 0.9rem;
//               padding: 0.6rem 1rem;
//             }
//           }
//         </style>
//       </head>
//       <body>
//         <h2>Authord configuration file is missing</h2>
//         <p>Would you like to create it?</p>
//         <button onclick="createConfig()">Create Configuration File</button>
//         <script>
//           const vscode = acquireVsCodeApi();
//           function createConfig() {
//             vscode.postMessage({ command: 'createConfigFile' });
//           }
//         </script>
//       </body>
//       </html>
//     `;
//   }

//   private getNormalViewHtml(): string {
//     return `
//       <!DOCTYPE html>
//       <html lang="en">
//       <head>
//         <meta charset="UTF-8">
//         <meta name="viewport" content="width=device-width, initial-scale=1.0">
//         <title>Authord</title>
//         <style>
//           body {
//             font-family: Arial, sans-serif;
//             margin: 0;
//             padding: 2rem;
//             box-sizing: border-box;
//             display: flex;
//             flex-direction: column;
//             align-items: center;
//             justify-content: center;
//             height: 100vh;
//             background-color: var(--vscode-editor-background);
//             color: var(--vscode-editor-foreground);
//           }
//           h2 {
//             font-size: 2rem;
//             text-align: center;
//             margin-bottom: 1rem;
//           }
//           p {
//             font-size: 1.2rem;
//             text-align: center;
//             margin-bottom: 2rem;
//           }
//           @media (max-width: 600px) {
//             h2 {
//               font-size: 1.5rem;
//             }
//             p {
//               font-size: 1rem;
//             }
//           }
//         </style>
//       </head>
//       <body>
//         <h2>Authord</h2>
//         <p>Please fix errors to proceed.</p>
//       </body>
//       </html>
//     `;
//   }
// }
