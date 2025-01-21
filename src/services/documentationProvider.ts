// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import TopicsProvider from './topicsProvider'; // Make sure `topicsProvider.ts` has a default export
import { InstanceConfig } from '../utils/types';
import DocumentationItem from './documentationItem'; // Moved into its own file to fix max-classes-per-file
import { DocumentationService } from './DocumentationService';

export default class DocumentationProvider implements vscode.TreeDataProvider<DocumentationItem> {
  private onDidChangeTreeDataEmitter = new vscode.EventEmitter<DocumentationItem | undefined | void>();
  
  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private instances: InstanceConfig[] = [];

  constructor(
    private readonly docService: DocumentationService,
    private readonly topicsProvider: TopicsProvider
  ) {
    this.refresh();
  }

  public refresh(): void {
    this.instances = this.docService.getAllDocuments();
    this.onDidChangeTreeDataEmitter.fire();
  }

  public getTreeItem(element: DocumentationItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(): Promise<DocumentationItem[]> {
    return this.instances.map((instance) => {
      const item = new DocumentationItem(
        instance.id,
        instance.name,
        vscode.TreeItemCollapsibleState.None
      );
      item.command = {
        command: 'authordDocsExtension.selectInstance',
        title: 'Select Instance',
        arguments: [instance.id],
      };
      item.contextValue = 'documentation';
      return item;
    });
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
    const existingIds = this.instances.map((doc) => doc.id);

    while (existingIds.includes(docId)) {
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

    const startPageFileName = `${title.replace(/\s+/g, '-').toLowerCase()}.md`;
    const aboutTitle = `About ${title}`;

    // Create a minimal TOC for the new doc
    const tocElements = [
      {
        topic: startPageFileName,
        title: aboutTitle,
        children: [],
      },
    ];

    const newDocument: InstanceConfig = {
      id: docId,
      name: title,
      'start-page': startPageFileName,
      'toc-elements': tocElements,
    };

    try {
      const added = await this.docService.addDoc(newDocument);
      if (added) {
        this.refresh();
        // Let TopicsProvider know about the new doc/toc
        this.topicsProvider.refresh(tocElements, docId);
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
