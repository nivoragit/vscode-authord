// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';

export default class DocumentationItem extends vscode.TreeItem {
    constructor(
      public id: string,
      label: string,
      collapsibleState: vscode.TreeItemCollapsibleState
    ) {
      super(label, collapsibleState);
      this.contextValue = 'documentation';
      this.id = id;
    }
  }
