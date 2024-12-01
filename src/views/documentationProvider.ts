import * as vscode from 'vscode';
import { InstanceConfig } from '../utils/types';


export class DocumentationProvider implements vscode.TreeDataProvider<DocumentationItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<DocumentationItem | undefined | void> = new vscode.EventEmitter<DocumentationItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<DocumentationItem | undefined | void> = this._onDidChangeTreeData.event;

  private instance: InstanceConfig;

  constructor(instance: InstanceConfig) {
    this.instance = instance;
  }

  refresh(instance: InstanceConfig): void {
    this.instance = instance;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DocumentationItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: DocumentationItem): Thenable<DocumentationItem[]> {
    if (!element) {
      // Root elements (instances)
      const item = new DocumentationItem(
        this.instance.name,
        vscode.TreeItemCollapsibleState.None
      );
      item.id = this.instance.id;
      item.command = {
        command: 'authordDocsExtension.selectInstance',
        title: 'Select Instance',
        arguments: [this.instance.id]
      };
      return Promise.resolve([item]);
    }
    return Promise.resolve([]);
  }
}

export class DocumentationItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
  }
}
