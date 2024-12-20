import * as vscode from 'vscode';
import { InstanceConfig, TocTreeItem } from '../utils/types';
import * as fs from 'fs';
import * as path from 'path';
import { TocElement, AbstractConfigManager } from '../config/abstractConfigManager';
import { XMLConfigurationManager } from '../config/XMLConfigurationManager';

import { InitializeExtension } from '../utils/initializeExtension';
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
    const items = this.instances.map(instance => {
      const item = new DocumentationItem(instance.id,instance.name, vscode.TreeItemCollapsibleState.None);
      item.command = {
        command: 'authordDocsExtension.selectInstance',
        title: 'Select Instance',
        arguments: [instance.id]
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
        this.topicsProvider.refresh([],undefined);
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

    const newName = await vscode.window.showInputBox({ prompt: 'Enter new documentation name', value: item.label as string });
    if (!newName) {
      vscode.window.showWarningMessage('Rename canceled.');
      return;
    }

    this.configManager.renameDocument(item.id as string, newName);
    this.refresh();
    vscode.window.showInformationMessage(`Renamed documentation "${item.label}" to "${newName}".`);
  }


  async addDoc(): Promise<void> {
    const title = await vscode.window.showInputBox({ prompt: 'Enter Documentation Name' });
    if (!title) {
      vscode.window.showWarningMessage('Document creation canceled.');
      return;
    }
    // removed folder for each doc
    // const docDir = path.join(this.configManager.getTopicsDir(), title.toLowerCase().replace(/\s+/g, '-'));

    // if (fs.existsSync(docDir)) {
    //   vscode.window.showInformationMessage(`Document "${title}" already exists.`);
    //   return;
    // }

    this.configManager.createDirectory(this.configManager.getTopicsDir());
    const newDocument: InstanceConfig = {
      id: title,
      name: title,
      "start-page": "",
      "toc-elements": []
    };

    this.configManager.addDocument(newDocument);
    // setup watcher for .tree file looking for external changes
    // if (this.configManager.constructor.name === 'XMLConfigurationManager') {
    //   this.setupXmlWatchers(this.configManager as XMLConfigurationManager, InitializeExtension);
    // }
    this.refresh();
  }
  // private setupXmlWatchers(manager: XMLConfigurationManager, InitializeExtension: InitializeExtension): void {
  //   manager.setupWatchers(InitializeExtension);
  // }

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

    const doc = this.configManager!.getDocuments().find(d => d.id === element.id);
    if (!doc) {
      vscode.window.showErrorMessage(`No document found with id ${element.label}`);
      return;
    }

    // Transform doc["toc-elements"] (TocElement[]) into TocTreeItem[]
    const tocTreeItems = doc["toc-elements"].map((e: TocElement) => {
      return {
        topic: e.topic,
        title: e.title,
        sortChildren: e.sortChildren,
        children: this.parseTocElements(e.children)
      };
    });

    this.topicsProvider!.refresh(tocTreeItems, element.id);
  }
}

export class DocumentationItem extends vscode.TreeItem {
  constructor(id: string,label: string, collapsibleState: vscode.TreeItemCollapsibleState) {
    super(label, collapsibleState);
    this.contextValue = 'documentation';
    this.id = id;
  }

}
