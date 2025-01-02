import * as vscode from 'vscode';
import { InstanceConfig, TocTreeItem } from '../utils/types';
import { TocElement, AbstractConfigManager } from '../configurationManagers/abstractConfigurationManager';
import { TopicsProvider } from './topicsProvider';

export class DocumentationProvider implements vscode.TreeDataProvider<DocumentationItem> {

  private _onDidChangeTreeData: vscode.EventEmitter<DocumentationItem | undefined | void> = new vscode.EventEmitter<DocumentationItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<DocumentationItem | undefined | void> = this._onDidChangeTreeData.event;

  private configManager: AbstractConfigManager;
  private instances: InstanceConfig[] = [];
  private topicsProvider: TopicsProvider;

  constructor(configManager: AbstractConfigManager, topicsProvider: TopicsProvider) {
    this.configManager = configManager;
    this.topicsProvider = topicsProvider;
    this.refresh();
  }

  refresh(): void {
    this.instances = this.configManager.getDocuments();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DocumentationItem): vscode.TreeItem {
    return element;
  }

  getChildren(): Thenable<DocumentationItem[]> {
    // For multiple instances, use Collapsed state
    const items = this.instances.map(instance => {
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
    return Promise.resolve(items);
  }

  /**
   * Deletes a documentation entry by prompting the user for confirmation.
   * Now handles the returned Promise<boolean> from the configManager.
   */
  async deleteDoc(item: DocumentationItem) {
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
        const deleted = await this.configManager.deleteDocument(item.id as string);
        if (deleted) {
          this.topicsProvider.refresh([], undefined);
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

  /**
   * Renames a documentation entry using user input.
   * Now handles the returned Promise<boolean> from the configManager.
   */
  async renameDoc(item: DocumentationItem) {
    if (!item.id) {
      vscode.window.showWarningMessage('No document selected for rename.');
      return;
    }

    const newName = await vscode.window.showInputBox({
      prompt: 'Enter new documentation name',
      value: item.label as string
    });
    if (!newName) {
      vscode.window.showWarningMessage('Rename canceled.');
      return;
    }

    try {
      const renamed = await this.configManager.renameDocument(item.id as string, newName);
      if (renamed) {
        this.refresh();
        vscode.window.showInformationMessage(`Renamed documentation "${item.label}" to "${newName}".`);
      } else {
        vscode.window.showErrorMessage(`Failed to rename documentation "${item.label}".`);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error while renaming documentation: ${error}`);
    }
  }

  /**
   * Creates a new documentation entry.
   * Uses asynchronous checks to verify if a similarly named directory already exists
   * and handles the returned Promise<boolean> from the configManager.addDocument method.
   */
  async addDoc(): Promise<void> {
    // Step 1: Prompt for the documentation title
    const title = await vscode.window.showInputBox({
      prompt: 'Enter Documentation Name',
      placeHolder: 'e.g., My Documentation',
    });
  
    if (!title) {
      vscode.window.showWarningMessage('Document creation canceled.');
      return;
    }
  
    // Step 2: Generate a default ID based on the title
    let defaultId = title
      .split(/\s+/)
      .map(word => word[0]?.toLowerCase() || '')
      .join('');
  
    // Step 3: Prompt for the instance ID with the default placeholder
    let docId = await vscode.window.showInputBox({
      prompt: 'Enter Document ID',
      value: defaultId, // Auto-generated default ID
      placeHolder: 'e.g., doc1',
    });
    if (!docId) {
      vscode.window.showWarningMessage('Document creation canceled.');
      return;
    }

    let counter = 1;
    // Check for existing IDs and adjust if necessary
    const existingIds = this.configManager.getDocuments().map(doc => doc.id);
    while (existingIds.includes(docId)) {
      defaultId = title
        .split(/\s+/)
        .map(word => word[counter]?.toLowerCase() || '')
        .join('');
      counter++;

      docId = await vscode.window.showInputBox({
        prompt: 'Enter different Document ID',
        value: defaultId, // Auto-generated default ID
        placeHolder: 'e.g., doc2',
      });
      if (!docId) {
        vscode.window.showWarningMessage('Document creation canceled.');
        return;
      }
    }
  
    // Step 4: Automatically generate the start page file name and "About ..." title
    const startPageFileName = title.replace(/\s+/g, '-').toLowerCase() + '.md';
    const aboutTitle = `About ${title}`;
  
    // Step 5: Ensure the topics directory exists
    await this.configManager.createDirectory(this.configManager.getTopicsDir());
  
    // Step 6: Create the new document object
    const newDocument: InstanceConfig = {
      id: docId,
      name: title,
      'start-page': startPageFileName,
      'toc-elements': [
        {
          topic: startPageFileName,
          title: aboutTitle,
          sortChildren: 'none',
          children: [],
        },
      ],
    };
  
    // Step 7: Add the document to the config manager and refresh
    try {
      const added = await this.configManager.addDocument(newDocument);
      if (added) {
        this.refresh();
        vscode.window.showInformationMessage(`Documentation "${title}" created successfully with ID "${docId}".`);
      } else {
        vscode.window.showErrorMessage(`Failed to create documentation "${title}" with ID "${docId}".`);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error while creating documentation: ${error}`);
    }
  }

  /**
   * Creates a new topic under the specified document.
   * Now handles the returned Promise<boolean> from the configManager.addTopic method.
   */
  async newTopic(element: DocumentationItem): Promise<void> {
    const topicTitle = await vscode.window.showInputBox({ prompt: 'Enter Topic Title' });
    if (!topicTitle) {
      vscode.window.showWarningMessage('Topic creation canceled.');
      return;
    }

    const safeFileName = `${topicTitle.toLowerCase().replace(/\s+/g, '-')}.md`;
    const newTopic: TocElement = {
      topic: safeFileName,
      title: topicTitle,
      sortChildren: "none",
      children: []
    };

    try {
      const added = await this.configManager.addTopic(element.id as string, null, newTopic);
      if (added) {
        this.refresh();

        const doc = this.configManager.getDocuments().find(d => d.id === element.id);
        if (!doc) {
          vscode.window.showErrorMessage(`No document found with id ${element.label}`);
          return;
        }
  
        const tocTreeItems = doc["toc-elements"].map((e: TocElement) => ({
          topic: e.topic,
          title: e.title,
          sortChildren: e.sortChildren,
          children: this.parseTocElements(e.children)
        }));
        this.topicsProvider.refresh(tocTreeItems, element.id);
      } else {
        vscode.window.showErrorMessage(`Failed to add topic "${topicTitle}" to documentation "${element.label}".`);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error while creating topic: ${error}`);
    }
  }

  private parseTocElements(tocElements: TocElement[]): TocTreeItem[] {
    return tocElements.map(element => {
      const children = element.children ? this.parseTocElements(element.children) : [];
      return {
        title: element.title,
        topic: element.topic,
        sortChildren: element.sortChildren,
        children,
      };
    });
  }
}

export class DocumentationItem extends vscode.TreeItem {
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
