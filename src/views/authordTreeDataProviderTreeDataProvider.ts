import * as vscode from 'vscode';

export class AuthordTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
      return element;
    }
    getChildren(_element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
      return []; // No child items for simplicity
    }
}