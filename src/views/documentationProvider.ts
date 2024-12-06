import * as vscode from 'vscode';
import { InstanceConfig, TocElement } from '../utils/types';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export class DocumentationProvider implements vscode.TreeDataProvider<DocumentationItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<DocumentationItem | undefined | void> = new vscode.EventEmitter<DocumentationItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<DocumentationItem | undefined | void> = this._onDidChangeTreeData.event;

  private instances: InstanceConfig[];
  private configPath: string;
  private topicsDir: string | undefined;

  constructor(instances: InstanceConfig[], configPath: string) {
    this.instances = instances;
    this.configPath = configPath;
  }

  refresh(instances: InstanceConfig[]): void {
    this.instances = instances;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DocumentationItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: DocumentationItem): Thenable<DocumentationItem[]> {
    if (!element) {
      // Root elements (instances)
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
        item.contextValue = 'documentation'; // Set contextValue to 'documentation'
        return item;
      });
      return Promise.resolve(items);
    }
    return Promise.resolve([]);
  }

  // Method to add a new documentation
  async addDocumentation(): Promise<void> {
    const title = await vscode.window.showInputBox({ prompt: 'Enter Documentation Name' });
    if (!title) {
      vscode.window.showWarningMessage('Doc creation canceled.');
      return;
    }
    const newId = uuidv4();
    const configData = this.readConfigFile();
    this.topicsDir = path.join(path.dirname(this.configPath), configData.topics.dir, `${title.toLowerCase()}`);
    const safeFileName = `${title.toLowerCase().replace(/\s+/g, '-')}-${newId}.md`;
    const filePath = path.join(this.topicsDir || '', safeFileName);


    try {
      fs.mkdirSync(this.topicsDir);
      fs.writeFileSync(filePath, `# ${title}\n\nContent goes here...`);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to create topic file: ${err}`);
      return;
    }

    const tocElement: TocElement = {
      id: newId,
      topic: safeFileName,
      "toc-title": "Introduction",
      "sort-children": "none",
    };
    const newDocumentation: InstanceConfig = {
      id: newId+'-doc',
      name: title.charAt(0).toUpperCase() + title.slice(1),
      "start-page": safeFileName,
      "toc-elements": [tocElement]
    };
    this.instances.push(newDocumentation);
    this.refresh(this.instances);
    this.updateConfigFile();

  }

  // Method to delete a documentation
  deleteDocumentation(element: DocumentationItem): void {
    this.instances = this.instances.filter(instance => instance.id !== element.id);
    this.refresh(this.instances);
    this.updateConfigFile();
  }

  // Helper method to update config.json
  private updateConfigFile(): void {
    const configData = this.readConfigFile();
    configData.instances = this.instances;
    fs.writeFileSync(this.configPath, JSON.stringify(configData, null, 2));
  }

  // Helper method to read config.json
  private readConfigFile(): any {
    try {
      const configContent = fs.readFileSync(this.configPath, 'utf-8');
      return JSON.parse(configContent);
    } catch (error) {
      vscode.window.showErrorMessage('Error reading config.json');
      return { instances: [] };
    }
  }
}

// Define the DocumentationItem class
export class DocumentationItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.contextValue = 'documentation'; // Set contextValue to 'documentation'
  }
}
