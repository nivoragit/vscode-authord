import * as vscode from 'vscode';
import { InstanceConfig, TocTreeItem } from '../utils/types';
import { TocElement, AbstractConfigManager } from '../config/abstractConfigManager';
import { TopicsProvider } from './topicsProvider';

export class DocumentationProvider implements vscode.TreeDataProvider<DocumentationItem> {

  private _onDidChangeTreeData: vscode.EventEmitter<DocumentationItem | undefined | void> = new vscode.EventEmitter<DocumentationItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<DocumentationItem | undefined | void> = this._onDidChangeTreeData.event;

  private configManager: AbstractConfigManager;
  private instances: InstanceConfig[] = [];
  private topicsProvider: TopicsProvider;
  singleInstance: InstanceConfig | undefined;

  constructor(configManager: AbstractConfigManager, topicsProvider: TopicsProvider) {
    this.configManager = configManager;
    this.topicsProvider = topicsProvider;
    this.refresh();
  }

  refresh(): void {
    const ins = this.configManager.getDocuments();
    if (ins.length === 1) {
      const tocTreeItems = ins[0]["toc-elements"].map((e: TocElement) => ({
        topic: e.topic,
        title: e.title,
        sortChildren: e.sortChildren,
        children: this.parseTocElements(e.children),
      }));
      this.topicsProvider!.refresh(tocTreeItems,ins[0].id);
      this.singleInstance = ins[0];
      this.instances = [];

    } else {
      this.instances = ins;
      this.singleInstance = undefined;
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DocumentationItem): vscode.TreeItem {
    return element;
  }

  getChildren(): Thenable<DocumentationItem[]> {
    if(this.singleInstance){
      return Promise.resolve([]);
    }
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

  deleteDoc(item: DocumentationItem) {
    if (!item.id) {
      vscode.window.showWarningMessage('No document selected for deletion.');
      return;
    }

    vscode.window.showWarningMessage(
      `Are you sure you want to delete documentation "${item.label}"?`,
      { modal: true },
      'Yes'
    ).then((confirm) => {
      if (confirm === 'Yes') {
        this.configManager.deleteDocument(item.id as string);
        this.topicsProvider.refresh([], undefined);
        this.refresh();
        vscode.window.showInformationMessage(`Deleted documentation "${item.label}".`);
      }
    });
  }

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

    this.configManager.renameDocument(item.id as string, newName);
    this.refresh();
    vscode.window.showInformationMessage(`Renamed documentation "${item.label}" to "${newName}".`);
  }

  /**
   * Creates a new documentation entry. 
   * Uses asynchronous checks (fs.promises.access) to verify if a similarly named directory already exists.
   * This is the most efficient approach to avoid blocking the main thread.
   */
    /**
   * Creates a new documentation entry. 
   * Uses asynchronous checks (fs.promises.access) to verify if a similarly named directory already exists.
   * This is the most efficient approach to avoid blocking the main thread.
   */
    /**
   * Creates a new documentation entry. 
   * Uses asynchronous checks (fs.promises.access) to verify if a similarly named directory already exists.
   * This is the most efficient approach to avoid blocking the main thread.
   */
    async addDoc(): Promise<void> {
      // Prompt for documentation title
      const title = await vscode.window.showInputBox({ prompt: 'Enter Documentation Name' });
      if (!title) {
        vscode.window.showWarningMessage('Document creation canceled.');
        return;
      }
  
      // Generate a default ID by taking the first letter of each word in the title and lowercasing it
      const defaultId = title
        .split(/\s+/)
        .map(word => word[0]?.toLowerCase() || '')
        .join('');
  
      // Prompt for the file ID with the default value
      const docId = await vscode.window.showInputBox({
        prompt: 'Enter Document ID',
        value: defaultId
      });
      if (!docId) {
        vscode.window.showWarningMessage('Document creation canceled.');
        return;
      }
  
      // Automatically generate the start page file name and "About ..." title
      const startPageFileName = title.replace(/\s+/g, '-').toLowerCase() + '.md';
      const aboutTitle = `About ${title}`;
  
      // Ensure the topics directory exists
      this.configManager.createDirectory(this.configManager.getTopicsDir());
  
      const newDocument: InstanceConfig = {
        id: docId,
        name: title,
        "start-page": startPageFileName,
        "toc-elements": [
          {
            topic: startPageFileName,
            title: aboutTitle,
            sortChildren: "none",
            children: []
          }
        ]
      };
  
      this.configManager.addDocument(newDocument);
      this.refresh();
    }
  
  
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

    this.configManager.addTopic(element.id as string, null, newTopic);
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
