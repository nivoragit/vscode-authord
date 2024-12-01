import * as vscode from 'vscode';
import { TocTreeItem } from '../utils/types';


export class TopicsProvider implements vscode.TreeDataProvider<TopicsItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TopicsItem | undefined | void> = new vscode.EventEmitter<TopicsItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TopicsItem | undefined | void> = this._onDidChangeTreeData.event;

  private tocTree: TocTreeItem[];

  constructor(tocTree: TocTreeItem[]) {
    this.tocTree = tocTree;
  }

  refresh(tocTree: TocTreeItem[]): void {
    this.tocTree = tocTree;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TopicsItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TopicsItem): Thenable<TopicsItem[]> {
    if (!element) {
      // Root elements
      return Promise.resolve(this.tocTree.map(item => this.createTreeItem(item)));
    } else {
      // Children of the element
      return Promise.resolve(
        element.children.map(item => this.createTreeItem(item))
      );
    }
  }

  private createTreeItem(element: TocTreeItem): TopicsItem {
    const hasChildren = element.children && element.children.length > 0;
    const treeItem = new TopicsItem(
      element.title,
      hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    treeItem.id = element.id;
    treeItem.children = element.children;
    if (element.filePath) {
      treeItem.command = {
        command: 'authordDocsExtension.openTopic',
        title: 'Open Topic',
        arguments: [element.filePath]
      };
    }
    return treeItem;
  }
}

export class TopicsItem extends vscode.TreeItem {
    children: TocTreeItem[];
  
    constructor(
      public readonly label: string,
      public collapsibleState: vscode.TreeItemCollapsibleState,
      children: TocTreeItem[] = []
    ) {
      super(label, collapsibleState);
      this.children = children;
    }
  }
  
