import * as vscode from 'vscode';
import { InstanceConfig } from '../utils/types';

export class DocumentationProvider implements vscode.TreeDataProvider<DocumentationItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<DocumentationItem | undefined | void> = new vscode.EventEmitter<DocumentationItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<DocumentationItem | undefined | void> = this._onDidChangeTreeData.event;

  private instances: InstanceConfig[];

  constructor(instances: InstanceConfig[]) {
    this.instances = instances;
  }

  refresh(instances: InstanceConfig[]): void {
    this.instances = instances;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DocumentationItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: DocumentationItem): Thenable<DocumentationItem[]> {
    if (!element) {
      // Root elements (instances)
      const items = this.instances.map(instance => {
        const item = new DocumentationItem(
          instance.name,
          vscode.TreeItemCollapsibleState.None
        );
        item.id = instance.id;
        item.command = {
          command: 'authordDocsExtension.selectInstance',
          title: 'Select Instance',
          arguments: [instance.id]
        };
        return item;
      });
      return Promise.resolve(items);
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

