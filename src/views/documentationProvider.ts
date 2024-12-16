import * as vscode from 'vscode';
import { InstanceConfig, TocElement } from '../utils/types';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AbstractConfigManager } from '../config/abstractConfigManager';


export class DocumentationProvider implements vscode.TreeDataProvider<DocumentationItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<DocumentationItem | undefined | void> = new vscode.EventEmitter<DocumentationItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<DocumentationItem | undefined | void> = this._onDidChangeTreeData.event;

  private configManager: AbstractConfigManager; 
  private instances: InstanceConfig[] = [];

  constructor(configManager: AbstractConfigManager) {
    this.configManager = configManager;
    this.instances = this.configManager.getDocuments();
  }

  refresh(): void {
    this.instances = this.configManager.getDocuments();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DocumentationItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: DocumentationItem): Thenable<DocumentationItem[]> {
    if (!element) {
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
        item.contextValue = 'documentation';
        return item;
      });
      return Promise.resolve(items);
    }
    return Promise.resolve([]);
  }

  async addDoc(): Promise<void> {
    const title = await vscode.window.showInputBox({ prompt: 'Enter Documentation Name' });
    if (!title) {
      vscode.window.showWarningMessage('Doc creation canceled.');
      return;
    }

    const newId = uuidv4();
    const configData = (this.configManager as any)['configData']; // If needed or use another public method
    const docFolderName = title.toLowerCase();
    const docDir = path.join(path.dirname(this.configManager.configPath), configData.topics.dir, docFolderName);

    try {
      this.configManager.createDirectory(docDir);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to create doc folder: ${error}`);
      return;
    }

    const newDocumentation: InstanceConfig = {
      id: newId,
      name: title.charAt(0).toUpperCase() + title.slice(1),
      "start-page": "",
      "toc-elements": []
    };

    this.configManager.addDocument(newDocumentation);
    this.refresh();
  }

  async newTopic(element: DocumentationItem): Promise<void> {
    if (!element.id) {
      vscode.window.showErrorMessage('Unable to add new topic: ID is missing.');
      return;
    }

    const tocTitle = await vscode.window.showInputBox({ prompt: 'Enter Topic Title' });
    if (!tocTitle) {
      vscode.window.showWarningMessage('Doc creation canceled.');
      return;
    }

    const newId = uuidv4();
    const safeFileName = `${tocTitle.toLowerCase().replace(/\s+/g, '-')}-${newId}.md`;
    const docInstance = this.instances.find(i => i.id === element.id);
    if (!docInstance) {
      vscode.window.showErrorMessage(`Instance with ID ${element.id} not found.`);
      return;
    }

    const docFolderName = docInstance.name.toLowerCase();
    const configData = (this.configManager as any)['configData'];
    const docDir = path.join(path.dirname(this.configManager.configPath), configData.topics.dir, docFolderName);

    const topicFolderName = tocTitle.toLowerCase().replace(/\s+/g, '-');
    const topicDir = path.join(docDir, topicFolderName);
    const filePath = path.join(topicDir, safeFileName);

    this.configManager.createDirectory(topicDir);
    this.configManager.writeFile(filePath, `# ${tocTitle}\n\nContent goes here...`);

    const tocElement: TocElement = {
      id: newId,
      topic: safeFileName,
      "toc-title": tocTitle,
      "sort-children": "none",
      "children": []
    };

    // Update configuration through manager
    this.configManager.addTopic(element.id, null, tocElement);
    this.configManager.setFilePathById(newId, filePath);

    this.refresh();
  }

  deleteDoc(element: DocumentationItem): void {
    if (!element.id) {
      vscode.window.showErrorMessage('Unable to delete documentation: ID is missing.');
      return;
    }

    const instanceToDelete = this.instances.find(instance => instance.id === element.id);
    if (!instanceToDelete) {
      vscode.window.showErrorMessage(`Instance with ID ${element.id} not found.`);
      return;
    }

    const docFolderName = instanceToDelete.name.toLowerCase();
    const configData = (this.configManager as any)['configData'];
    const folderPath = path.join(path.dirname(this.configManager.configPath), configData.topics.dir, docFolderName);
    this.configManager.moveFolderToTrash(folderPath);


    // Remove file-path entries for this doc's topics
    for (const tocElement of instanceToDelete["toc-elements"]) {
      this.configManager.removeFilePathById(tocElement.id);
    }

    this.configManager.deleteDocument(element.id);
    this.refresh();
  }

  async renameDoc(element: DocumentationItem): Promise<void> {
    if (!element.id) {
      vscode.window.showErrorMessage('Unable to rename Doc: ID is missing.');
      return;
    }
    const docTitle = await vscode.window.showInputBox({ prompt: 'Enter New Title' });
    if (!docTitle) {
      vscode.window.showWarningMessage('Doc rename canceled.');
      return;
    }

    const doc = this.instances.find(d => d.id === element.id);
    if (!doc) {
      vscode.window.showErrorMessage(`Instance with ID ${element.id} not found.`);
      return;
    }

    const configData = (this.configManager as any)['configData'];
    const docsDir = path.join(path.dirname(this.configManager.configPath), configData.topics.dir);
    const sourceFilePath = path.join(docsDir, doc.name);
    doc.name = docTitle.charAt(0).toUpperCase() + docTitle.slice(1);
    const newDestinationFilePath = path.join(docsDir, doc.name);

    fs.renameSync(sourceFilePath, newDestinationFilePath);
    this.configManager.renameDocument(element.id, doc.name);
    this.refresh();
  }

  private mergeFolders(source: string, destination: string): void {
    const sourceFiles = fs.readdirSync(source);
    for (const file of sourceFiles) {
      const sourceFilePath = path.join(source, file);
      const destinationFilePath = path.join(destination, file);

      if (fs.statSync(sourceFilePath).isDirectory()) {
        if (!fs.existsSync(destinationFilePath)) {
          fs.mkdirSync(destinationFilePath);
        }
        this.mergeFolders(sourceFilePath, destinationFilePath);
      } else {
        if (fs.existsSync(destinationFilePath)) {
          const newFileName = `${path.basename(file, path.extname(file))}-${Date.now()}${path.extname(file)}`;
          const newDestinationFilePath = path.join(destination, newFileName);
          fs.renameSync(sourceFilePath, newDestinationFilePath);
        } else {
          fs.renameSync(sourceFilePath, destinationFilePath);
        }
      }
    }
  }
}

export class DocumentationItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.contextValue = 'documentation';
  }
}
