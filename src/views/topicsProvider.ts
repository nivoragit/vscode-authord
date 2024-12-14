import * as vscode from 'vscode';
import { TocTreeItem } from '../utils/types';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export class TopicsProvider implements vscode.TreeDataProvider<TopicsItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TopicsItem | undefined | void> = new vscode.EventEmitter<TopicsItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TopicsItem | undefined | void> = this._onDidChangeTreeData.event;

  private tocTree: TocTreeItem[];
  private configPath: string;
  private topicsDir: string | undefined; // Directory where .md files are located
  private currentDocInstanceId: string | undefined;

  constructor(tocTree: TocTreeItem[], configPath: string) {
    this.tocTree = tocTree;
    this.configPath = configPath;

    // Initialize topics directory from config
    const configData = this.readConfigFile();
    if (configData && configData.topics && configData.topics.dir) {
      this.topicsDir = path.join(path.dirname(this.configPath), configData.topics.dir);
      if (!fs.existsSync(this.topicsDir)) {
        fs.mkdirSync(this.topicsDir, { recursive: true });
        fs.mkdirSync(path.join(path.dirname(this.configPath), 'trash'));
      }
    }
  }

  refresh(tocTree: TocTreeItem[], instanceId?: string): void {
    if (instanceId) { this.currentDocInstanceId = instanceId; }
    this.tocTree = tocTree;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TopicsItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TopicsItem): Thenable<TopicsItem[]> {
    if (!element) {
      // If no document is selected (e.g., tocTree is empty), show a placeholder
      if (!this.tocTree || this.tocTree.length === 0) {
        const noDocItem = new vscode.TreeItem('No document selected');
        noDocItem.contextValue = 'noDocSelected';
        noDocItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
        return Promise.resolve([noDocItem as TopicsItem]);
      }

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
      hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
      element.children
    );
    treeItem.id = element.id;
    treeItem.children = element.children;
    treeItem.contextValue = 'topic';

    const filePath = this.getFilePathById(element.id);
    if (filePath) {
      treeItem.command = {
        command: 'authordExtension.openMarkdownFile',
        title: 'Open Markdown File',
        arguments: [filePath]
      };
    }
    return treeItem;
  }

  async addTopic(element?: TopicsItem): Promise<void> {
    if (!this.tocTree || this.tocTree.length === 0) {
      vscode.window.showInformationMessage('No document selected. Cannot create a new topic.');
      return;
    }
  
    const title = await vscode.window.showInputBox({ prompt: 'Enter Topic Title' });
    if (!title) {
      vscode.window.showWarningMessage('Topic creation canceled.');
      return;
    }
  
    const newId = uuidv4();
    const safeFileName = `${title.toLowerCase().replace(/\s+/g, '-')}-${newId}.md`;
    
    // Determine the doc path
    const docPath = this.getDocPath();
    const topicFolderName = title.toLowerCase().replace(/\s+/g, '-');
  
    let parentDir = docPath;
    if (element && element.id) {
      const parentFilePath = this.getFilePathById(element.id);
      if (parentFilePath) {
        // Place the new topic folder inside the parent's folder
        parentDir = path.join(path.dirname(parentFilePath), topicFolderName);
      } else {
        parentDir = path.join(docPath, topicFolderName);
      }
    } else {
      // No parent - create topic folder directly under doc path
      parentDir = path.join(docPath, topicFolderName);
    }
  
    const filePath = path.join(parentDir, safeFileName);
    fs.mkdirSync(parentDir, { recursive: true });
    fs.writeFileSync(filePath, `# ${title}\n\nContent goes here...`);
  
    const newTopic: TocTreeItem = {
      id: newId,
      title: title,
      sortChildren: "none",
      children: []
    };
  
    if (element && element.id) {
      this.findAndAddTopicToParent(element.id, this.tocTree, newTopic);
    } else {
      this.tocTree.push(newTopic);
    }
  
    this.setFilePathById(newId, filePath);
    this.updateConfigFile();
  }
  
// Most Efficient Updated Code Snippet

// In the deleteTopic method, before renaming the directory to the trash folder,
// ensure that if the target directory already exists, merge the contents instead 
// of directly renaming. This avoids the ENOTEMPTY error.

deleteTopic(element: TopicsItem): void {
  if (!element.id) {
    vscode.window.showErrorMessage('Unable to delete topic: ID is missing.');
    return;
  }

  const filePath = this.getFilePathById(element.id);
  if (!filePath || !fs.existsSync(filePath)) {
    vscode.window.showErrorMessage('Topic file not found or missing in file-paths.');
    return;
  }

  const sourceDir = path.dirname(filePath);
  const trashPath = path.join(path.dirname(this.configPath), 'trash');
  if (!fs.existsSync(trashPath)) {
    fs.mkdirSync(trashPath, { recursive: true });
  }

  const targetDir = path.join(trashPath, path.basename(sourceDir));

  try {
    if (fs.existsSync(targetDir)) {
      // If target exists, merge folders and then remove sourceDir
      this.mergeFolders(sourceDir, targetDir);
      fs.rmdirSync(sourceDir, { recursive: true });
    } else {
      fs.renameSync(sourceDir, targetDir);
    }

    this.removeTopicById(element.id, this.tocTree);
    this.removeFilePathById(element.id);
    this.updateConfigFile();

  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to move topic folder to trash: ${error.message}`);
  }
}

// Reuse the mergeFolders method from DocumentationProvider or define it similarly here
// This will merge all files and subfolders from source into destination without overwriting:
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

  async renameTopic(element: TopicsItem): Promise<void> {
    if (!element.id) {
      vscode.window.showErrorMessage('Unable to rename topic: ID is missing.');
      return;
    }
    const newName = await vscode.window.showInputBox({ prompt: 'Enter New Title' });
    if (!newName) {
      vscode.window.showWarningMessage('Doc rename canceled.');
      return;
    }
    const topicToRename = this.findAndRename(element.id, this.tocTree, newName);
    if (!topicToRename) {
      vscode.window.showErrorMessage('Topic not found.');
      return;
    }

    this.updateConfigFile();
  }

  private getDocTitle(): string {
    const configData = this.readConfigFile();
    if (configData && configData.instances && configData.instances.length > 0) {
      for (const instance of configData.instances) {
        if (instance.id === this.currentDocInstanceId) {
          return instance.name.toLowerCase();
        }
      }
    }
    return "fff";
  }

  private getDocPath(): string {
    const configData = this.readConfigFile();
    if (!this.topicsDir) {
      if (configData && configData.topics && configData.topics.dir) {
        this.topicsDir = path.join(path.dirname(this.configPath), configData.topics.dir);
        if (!fs.existsSync(this.topicsDir)) {
          fs.mkdirSync(this.topicsDir, { recursive: true });
          fs.mkdirSync(path.join(path.dirname(this.configPath), 'trash'));
        }
      }
    }
    return this.topicsDir!;
  }

  private updateConfigFile(): void {
    const configData = this.readConfigFile();

    if (configData && configData.instances && configData.instances.length > 0) {
      let instanceFound = false;

      for (const instance of configData.instances) {
        if (instance.id === this.currentDocInstanceId) {
          instance["toc-elements"] = this.convertTocTreeToTocElements(this.tocTree, configData);
          instanceFound = true;
          break;
        }
      }

      if (instanceFound) {
        fs.writeFileSync(this.configPath, JSON.stringify(configData, null, 2));
      } else {
        vscode.window.showErrorMessage(
          `Instance with ID ${this.currentDocInstanceId} not found in config.`
        );
      }
    } else {
      vscode.window.showErrorMessage('No instances found in config to update.');
    }
  }

  private convertTocTreeToTocElements(tocTree: TocTreeItem[], configData: any): any[] {
    return tocTree.map(item => {
      const filePath = this.getFilePathById(item.id);
      return {
        id: item.id,
        "topic": filePath ? path.basename(filePath) : "",
        "toc-title": item.title,
        "sort-children": item.sortChildren,
        "children": this.convertTocTreeToTocElements(item.children || [], configData)
      };
    });
  }

  private readConfigFile(): any {
    try {
      const configContent = fs.readFileSync(this.configPath, 'utf-8');
      return JSON.parse(configContent);
    } catch (error) {
      vscode.window.showErrorMessage(`Error reading config.json: ${error}`);
      return { instances: [], topics: { dir: "topics" }, "file-paths": {} };
    }
  }

  private getFilePathById(id: string): string | undefined {
    const configData = this.readConfigFile();
    return configData["file-paths"] ? configData["file-paths"][id] : undefined;
  }

  private setFilePathById(id: string, filePath: string): void {
    const configData = this.readConfigFile();
    if (!configData["file-paths"]) {
      configData["file-paths"] = {};
    }
    configData["file-paths"][id] = filePath;
    fs.writeFileSync(this.configPath, JSON.stringify(configData, null, 2));
  }
  private findAndAddTopicToParent(parentId: string, topics: TocTreeItem[], newTopic: TocTreeItem): boolean {
    for (const topic of topics) {
      if (topic.id === parentId) {
        topic.children.push(newTopic);
        return true;
      } else if (topic.children && topic.children.length > 0) {
        if (this.findAndAddTopicToParent(parentId, topic.children, newTopic)) {
          return true;
        }
      }
    }
    return false;
  }

  private removeFilePathById(id: string): void {
    const configData = this.readConfigFile();
    if (configData["file-paths"] && configData["file-paths"][id]) {
      delete configData["file-paths"][id];
      fs.writeFileSync(this.configPath, JSON.stringify(configData, null, 2));
    }
  }

  private findTopicById(id: string, topics: TocTreeItem[]): TocTreeItem | undefined {
    for (const topic of topics) {
      if (topic.id === id) {
        return topic;
      } else if (topic.children) {
        const found = this.findTopicById(id, topic.children);
        if (found) { return found; }
      }
    }
    return undefined;
  }


  private findAndRename(id: string, topics: TocTreeItem[], newName: string): boolean {
    for (const topic of topics) {
      if (topic.id === id) {
        topic.title = newName;
        return true;
      } else if (topic.children) {
        const renamed = this.findAndRename(id, topic.children, newName);
        if (renamed) {return true;}
      }
    }
    return false;
  }

  private removeTopicById(id: string, topics: TocTreeItem[]) {
    const index = topics.findIndex(topic => topic.id === id);
    if (index > -1) {
      topics.splice(index, 1);
      return true;
    } else {
      for (const topic of topics) {
        if (topic.children) {
          const removed = this.removeTopicById(id, topic.children);
          if (removed) { return true; }
        }
      }
    }
    return false;
  }
}

// Define the TopicsItem class
export class TopicsItem extends vscode.TreeItem {
  children: TocTreeItem[];

  constructor(
    public readonly label: string,
    public collapsibleState: vscode.TreeItemCollapsibleState,
    children: TocTreeItem[] = []
  ) {
    super(label, collapsibleState);
    this.children = children;
    this.contextValue = 'topic';
  }
}