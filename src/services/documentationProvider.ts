// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import AbstractConfigManager from '../configurationManagers/abstractConfigurationManager';
import TopicsProvider from './topicsProvider'; // Make sure `topicsProvider.ts` has a default export
import { InstanceConfig } from '../utils/types';
import DocumentationItem from './documentationItem'; // Moved into its own file to fix max-classes-per-file

export default class DocumentationProvider implements vscode.TreeDataProvider<DocumentationItem> {
  private onDidChangeTreeDataEmitter: vscode.EventEmitter<DocumentationItem | undefined | void> 
    = new vscode.EventEmitter<DocumentationItem | undefined | void>();

  public readonly onDidChangeTreeData: vscode.Event<DocumentationItem | undefined | void> 
    = this.onDidChangeTreeDataEmitter.event;

  private configManager: AbstractConfigManager;

  private instances: InstanceConfig[] = [];

  private topicsProvider: TopicsProvider;

  public constructor(configManager: AbstractConfigManager, topicsProvider: TopicsProvider) {
    this.configManager = configManager;
    this.topicsProvider = topicsProvider;
    this.refresh();
  }

  public refresh(): void {
    this.instances = this.configManager.getDocuments();
    this.onDidChangeTreeDataEmitter.fire();
  }

  /* eslint-disable class-methods-use-this */
  public getTreeItem(element: DocumentationItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(): Promise<DocumentationItem[]> {
    const items = this.instances.map((instance) => {
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
    return items;
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

    if (confirm === 'Yes') {
      try {
        const deleted = await this.configManager.deleteDocument(item.id);
        if (deleted) {
          this.topicsProvider.refresh([], null);
          this.refresh();
          vscode.window.showInformationMessage(`Deleted documentation "${item.label}".`);
        } else {
          vscode.window.showErrorMessage(`Failed to delete documentation "${item.label}".`);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Error while deleting documentation: ${error}`);
      }
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
      const renamed = await this.configManager.renameDocument(item.id, newName);
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

    // Generate default ID
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

    let counter = 1;
    const existingIds = this.configManager.getDocuments().map((doc) => doc.id);

    // Helper function to avoid no-loop-func rule
    const generateId = (docTitle: string, index: number): string =>
      docTitle
        .split(/\s+/)
        .map((word) => word[index]?.toLowerCase() || '')
        .join('');

    // If an ID already exists, prompt for a new one
    while (existingIds.includes(docId)) {
      defaultId = generateId(title, counter);
      counter += 1;

      // eslint-disable-next-line no-await-in-loop
      docId = await vscode.window.showInputBox({
        prompt: 'Enter different Document ID',
        value: defaultId,
        placeHolder: 'e.g., doc2',
      });

      if (!docId) {
        vscode.window.showWarningMessage('Document creation canceled.');
        return;
      }
    }

    const startPageFileName = `${title.replace(/\s+/g, '-').toLowerCase()}.md`;
    const aboutTitle = `About ${title}`;

    await vscode.workspace.fs.createDirectory(
      vscode.Uri.file(this.configManager.getTopicsDir())
    );

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
      const added = await this.configManager.addDocument(newDocument);
      if (added) {
        this.refresh();
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
