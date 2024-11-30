// // src/views/previewManager.ts
// import * as vscode from 'vscode';
// import { processMarkdown } from '../utils/remarkProcessor';
// import { getWebviewContent } from '../utils/webviewUtils';

// class PreviewManager {
//   private static instance: PreviewManager | null = null;
//   private previewPanel: vscode.WebviewPanel | undefined;

//   private constructor() {}

//   public static getInstance(): PreviewManager {
//     if (!PreviewManager.instance) {
//       PreviewManager.instance = new PreviewManager();
//     }
//     return PreviewManager.instance;
//   }

//   public hasPreviewPanel(): boolean {
//     return !!this.previewPanel;
//   }

//   public showPreview(context: vscode.ExtensionContext, document: vscode.TextDocument): void {
//     if (!this.previewPanel) {
//       // Create a new panel in column 2
//       this.previewPanel = vscode.window.createWebviewPanel(
//         'markdownPreview',
//         'Markdown Preview',
//         vscode.ViewColumn.Two,
//         {
//           enableScripts: true,
//           retainContextWhenHidden: true,
//           localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
//         }
//       );

//       // Handle the panel being closed
//       this.previewPanel.onDidDispose(() => {
//         this.previewPanel = undefined;
//       });
//     } else {
//       // Ensure the panel is in column 2
//       if (this.previewPanel.viewColumn !== vscode.ViewColumn.Two) {
//         this.previewPanel.reveal(vscode.ViewColumn.Two, true);
//       }
//     }

//     // Update the content of the preview
//     this.updatePreview(context, document);
//   }

//   public async updatePreview(
//     context: vscode.ExtensionContext,
//     document: vscode.TextDocument
//   ): Promise<void> {
//     if (!this.previewPanel) {
//       return;
//     }

//     // Ensure the preview panel is in column 2
//     if (this.previewPanel.viewColumn !== vscode.ViewColumn.Two) {
//       this.previewPanel.reveal(vscode.ViewColumn.Two, true);
//     }

//     try {
//       const markdownContent = document.getText();
//       const processedContent = await processMarkdown(markdownContent);
//       this.previewPanel.webview.html = getWebviewContent(
//         processedContent,
//         this.previewPanel,
//         context
//       );
//     } catch (error) {
//       console.error('Error updating preview:', error);
//       vscode.window.showErrorMessage('Failed to update the Markdown preview.');
//     }
//   }
// }

// export const previewManager = PreviewManager.getInstance();
