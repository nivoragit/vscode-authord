import * as vscode from 'vscode';
import * as path from 'path';

export class MarkdownFileProvider implements vscode.TreeDataProvider<MarkdownFileItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<MarkdownFileItem | undefined | void> =
    new vscode.EventEmitter<MarkdownFileItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<MarkdownFileItem | undefined | void> =
    this._onDidChangeTreeData.event;

  constructor(private workspaceRoot: string | undefined) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: MarkdownFileItem): vscode.TreeItem {
    return element;
  }

  async getChildren(_element?: MarkdownFileItem): Promise<MarkdownFileItem[]> {
    if (!this.workspaceRoot) {
      vscode.window.showInformationMessage('No workspace folder found');
      return [];
    }

    const markdownFiles = await vscode.workspace.findFiles('**/*.md');

    const items = markdownFiles.map((uri) => {
      const label = path.basename(uri.fsPath);
      return new MarkdownFileItem(label, uri);
    });

    return items;
  }
}

class MarkdownFileItem extends vscode.TreeItem {
  constructor(public readonly label: string, public readonly resourceUri: vscode.Uri) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.command = {
      command: 'authordExtension.openMarkdownFile',
      title: 'Open Markdown File',
      arguments: [this.resourceUri],
    };
    this.contextValue = 'markdownFileItem';
  }
}
