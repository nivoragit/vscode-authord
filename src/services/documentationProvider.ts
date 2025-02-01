/*
    Presentation Layer
    └─ UI Components
*/
// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import TopicsProvider from './TopicsProvider';
import DocumentationItem from './DocumentationItem';
import DocumentationService from './DocumentationService';

export default class DocumentationProvider implements vscode.TreeDataProvider<DocumentationItem> {
  private onDidChangeTreeDataEmitter = new vscode.EventEmitter<DocumentationItem | undefined | void>();

  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(
    private readonly docService: DocumentationService,
    private readonly topicsProvider: TopicsProvider
  ) {
    this.refresh();
  }

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  // eslint-disable-next-line class-methods-use-this
  public getTreeItem(element: DocumentationItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(): Promise<DocumentationItem[]> {
    return this.docService.getDocumentationItems();
  }

  public async deleteDoc(item: DocumentationItem): Promise<void> {
    if (!item.id) {
      vscode.window.showWarningMessage('No document selected for deletion.');
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to delete documentation "${item.label}"?`,
      { modal: true },
      'Yes'
    );
    if (confirm !== 'Yes') return;

    try {
      const deleted = await this.docService.deleteDoc(item.id);
      if (deleted) {
        // Optionally refresh related tree(s)
        this.topicsProvider.refresh([]);
        this.refresh();
        vscode.window.showInformationMessage(`Deleted documentation "${item.label}".`);
      } else {
        vscode.window.showErrorMessage(`Failed to delete documentation "${item.label}".`);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error while deleting documentation: ${error}`);
    }
  }

  public async renameDoc(item: DocumentationItem): Promise<void> {
    if (!item.id) {
      vscode.window.showWarningMessage('No document selected for rename.');
      return;
    }

    const newName = await vscode.window.showInputBox({
      prompt: 'Enter new documentation name',
      value: item.label as string,
    });
    if (!newName) {
      vscode.window.showWarningMessage('Rename canceled.');
      return;
    }

    try {
      const renamed = await this.docService.renameDoc(item.id, newName);
      if (renamed) {
        this.refresh();
        vscode.window.showInformationMessage(
          `Renamed documentation "${item.label}" to "${newName}".`
        );
      } else {
        vscode.window.showErrorMessage(`Failed to rename documentation "${item.label}".`);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error while renaming documentation: ${error}`);
    }
  }

  public async addDoc(): Promise<void> {
    const title = await vscode.window.showInputBox({
      prompt: 'Enter Documentation Name',
      placeHolder: 'e.g., My Documentation',
    });
    if (!title) {
      vscode.window.showWarningMessage('Document creation canceled.');
      return;
    }

    // Generate default ID from the title
    let defaultId = title
      .split(/\s+/)
      .map((word) => word[0]?.toLowerCase() || '')
      .join('');

    let docId = await vscode.window.showInputBox({
      prompt: 'Enter Document ID',
      value: defaultId,
      placeHolder: 'e.g., doc1',
    });
    if (!docId) {
      vscode.window.showWarningMessage('Document creation canceled.');
      return;
    }

    // Check uniqueness of ID
    let counter = 1;
    while (!this.docService.isDocIdUnique(docId)) {
      defaultId = `${defaultId}${counter}`;
      counter += 1;
      docId = await vscode.window.showInputBox({
        prompt: 'Enter different Document ID',
        value: defaultId,
      });
      if (!docId) {
        vscode.window.showWarningMessage('Document creation canceled.');
        return;
      }
    }
    try {
      const newDocument = await this.docService.addDoc(docId, title);
      if (newDocument) {
        this.refresh();
        // Let TopicsProvider know about the new doc/toc
        this.topicsProvider.refresh(newDocument['toc-elements'], docId);
        vscode.window.showInformationMessage(
          `Documentation "${title}" created successfully with ID "${docId}".`
        );
      } else {
        vscode.window.showErrorMessage(
          `Failed to create documentation "${title}" with ID "${docId}".`
        );
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error while creating documentation: ${error}`);
    }
  }
}