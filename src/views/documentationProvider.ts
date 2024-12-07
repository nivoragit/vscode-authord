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
  async addDoc(): Promise<void> {
    const title = await vscode.window.showInputBox({ prompt: 'Enter Documentation Name' });
    if (!title) {
      vscode.window.showWarningMessage('Doc creation canceled.');
      return;
    }
    const newId = uuidv4();
    const configData = this.readConfigFile();
    const docsDir = path.join(path.dirname(this.configPath), configData.topics.dir, `${title.toLowerCase()}`);
    const safeFileName = `${title.toLowerCase().replace(/\s+/g, '-')}-${newId}.md`;
    const filePath = path.join(docsDir, safeFileName);


    try {
      fs.mkdirSync(docsDir);
      fs.writeFileSync(filePath, `# ${title}\n\nContent goes here...`);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to create topic file: ${err}`);
      return;
    }
    const tocTitle = await vscode.window.showInputBox({ prompt: 'Enter Topic Title' });
    if (!tocTitle) {
      vscode.window.showWarningMessage('Doc creation canceled.');
      return;
    }
    const tocElement: TocElement = {
      id: newId,
      topic: safeFileName,
      "toc-title": `${tocTitle.charAt(0).toUpperCase()}${tocTitle.slice(1)}`,
      "sort-children": "none",
    };
    const newDocumentation: InstanceConfig = {
      id: newId + '-doc',
      name: title.charAt(0).toUpperCase() + title.slice(1),
      "start-page": safeFileName,
      "toc-elements": [tocElement]
    };
    this.instances.push(newDocumentation);
    this.refresh(this.instances);
    this.updateConfigFile();

  }

  // Method to delete a documentation
  deleteDoc(element: DocumentationItem): void {
    if (!element.id) {
      vscode.window.showErrorMessage('Unable to delete documentation: ID is missing.');
      return;
    }

    // Remove the documentation from the list
    this.instances = this.instances.filter(instance => instance.id !== element.id);;
    const configData = this.readConfigFile();
    const folderPath = path.join(path.dirname(this.configPath), configData.topics.dir, String(element.label));
    const trashPath = path.join(path.dirname(this.configPath), 'trash');

    try {
      // Ensure the trash folder exists
      if (!fs.existsSync(trashPath)) {
        fs.mkdirSync(trashPath, { recursive: true });
      }

      // Merge contents of folderPath into trashPath
      const destinationPath = path.join(trashPath, path.basename(folderPath));
      if (fs.existsSync(destinationPath)) {
        this.mergeFolders(folderPath, destinationPath);
        fs.rmdirSync(folderPath, { recursive: true }); // Remove source folder after merging
      } else {
        fs.renameSync(folderPath, destinationPath);
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to move folder to trash: ${error.message}`);
    }

    // Refresh the instances and update the config file
    this.refresh(this.instances);
    this.updateConfigFile();
  }
  async newTopic(element: DocumentationItem): Promise<void> {
    if (!element.id) {
      vscode.window.showErrorMessage('Unable to add new topic: ID is missing.');
      return;
    }
    const configData = this.readConfigFile();
    if (configData && configData.instances && configData.instances.length > 0) {
      let instanceFound = false;
      const tocTitle = await vscode.window.showInputBox({ prompt: 'Enter Topic Title' });
      if (!tocTitle) {
        vscode.window.showWarningMessage('Doc creation canceled.');
        return;
      }
      const newId = uuidv4();
      const safeFileName = `${tocTitle.toLowerCase().replace(/\s+/g, '-')}-${newId}.md`;
      const tocElement: TocElement = {
        id: newId,
        topic: safeFileName,
        "toc-title": `${tocTitle.charAt(0).toUpperCase()}${tocTitle.slice(1)}`,
        "sort-children": "none",
      };
      for (const instance of configData.instances) {
        if (instance.id === element.id) {
          instance["toc-elements"].push(tocElement);
          instanceFound = true;
          break;
        }
      }

      if (instanceFound) {
        // Write the updated configData back to the file
        // todo move this to update config file method
        fs.writeFileSync(this.configPath, JSON.stringify(configData, null, 2));
      } else {
        vscode.window.showErrorMessage(
          `Instance with ID ${element.id} not found in config.`
        );
      }
    }

    // Refresh the instances and update the config file
    // this.refresh(this.instances);d
    // this.updateConfigFile();
  }
  async renameDoc(element: DocumentationItem): Promise<void> {
    if (!element.id) {
      vscode.window.showErrorMessage('Unable to add rename Doc: ID is missing.');
      return;
    }
    const configData = this.readConfigFile();
    if (configData && configData.instances && configData.instances.length > 0) {
      let instanceFound = false;
      const docTitle = await vscode.window.showInputBox({ prompt: 'Enter New Title' });
      if (!docTitle) {
        vscode.window.showWarningMessage('Doc rename canceled.');
        return;
      }
      const docsDir = path.join(path.dirname(this.configPath), configData.topics.dir);
      for (const instance of configData.instances) {
        if (instance.id === element.id) {
          if (docsDir) {
            const sourceFilePath = path.join(docsDir, instance.name);
            instance.name = docTitle.charAt(0).toUpperCase() + docTitle.slice(1);
            const newDestinationFilePath = path.join(docsDir, instance.name);

            fs.renameSync(sourceFilePath, newDestinationFilePath);
            instanceFound = true;
          } else {
            vscode.window.showErrorMessage('topicsDir not defined');
          }
          break;
        }
      }

      // Refresh the instances and update the config file
      if (instanceFound) {
        this.refresh(configData.instances);
        this.updateConfigFile();
      }

    }
  }
  // Helper method to merge contents of source folder into destination folder
  private mergeFolders(source: string, destination: string): void {
    const sourceFiles = fs.readdirSync(source);

    for (const file of sourceFiles) {
      const sourceFilePath = path.join(source, file);
      const destinationFilePath = path.join(destination, file);

      if (fs.statSync(sourceFilePath).isDirectory()) {
        // If it's a directory, recursively merge
        if (!fs.existsSync(destinationFilePath)) {
          fs.mkdirSync(destinationFilePath);
        }
        this.mergeFolders(sourceFilePath, destinationFilePath);
      } else {
        // If it's a file, handle conflicts
        if (fs.existsSync(destinationFilePath)) {
          // Rename file to avoid overwriting
          const newFileName = `${path.basename(file, path.extname(file))}-${Date.now()}${path.extname(file)}`;
          const newDestinationFilePath = path.join(destination, newFileName);
          fs.renameSync(sourceFilePath, newDestinationFilePath);
        } else {
          // Move file directly if no conflict
          fs.renameSync(sourceFilePath, destinationFilePath);
        }
      }
    }
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