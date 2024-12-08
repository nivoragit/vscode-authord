import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

export abstract class AbstractConfigManager {
  configPath: string;

  constructor(configPath: string) {
    this.configPath = configPath;
  }

  // Document-specific methods
  abstract addDocument(newDocument: any): void;
  abstract deleteDocument(docId: string): void;
  abstract renameDocument(docId: string, newName: string): void;
  abstract getDocuments(): any[];

  // Topic-specific methods
  abstract addTopic(docId: string, parentTopicId: string | null, newTopic: any): void;
  abstract deleteTopic(docId: string, topicId: string): void;
  abstract renameTopic(docId: string, topicId: string, newName: string): void;
  abstract moveTopic(docId: string, topicId: string, newParentId: string | null): void;
  abstract getTopics(docId: string): any[];

  // File-path methods
  abstract getFilePathById(id: string): string | undefined;
  abstract setFilePathById(id: string, filePath: string): void;
  abstract removeFilePathById(id: string): void;

  // Refresh configuration
  abstract refresh(): void;

  // New file and directory operations
  abstract createDirectory(dirPath: string): void;
  abstract writeFile(filePath: string, content: string): void;
  abstract renamePath(oldPath: string, newPath: string): void;
  abstract fileExists(filePath: string): boolean;
  abstract moveFolderToTrash(folderPath: string): void;
  abstract mergeFolders(source: string, destination: string): void;
}

  
// export abstract class AbstractConfigManager {
//   protected configPath: string;

//   constructor(configPath: string) {
//     this.configPath = configPath;
//   }

//   // Document-specific methods
//   abstract addDocument(newDocument: object): void;
//   abstract deleteDocument(docId: string): void;
//   abstract renameDocument(docId: string, newName: string): void;

//   // Topic-specific methods
//   abstract addTopic(parentTopicId: string | null, newTopic: object): void;
//   abstract deleteTopic(topicId: string): void;
//   abstract renameTopic(topicId: string, newName: string): void;
//   abstract moveTopic(topicId: string, newParentId: string | null): void;

//   // Refresh configuration in memory
//   abstract refresh(): void;

//   // Generate a unique ID
//   generateId(): string {
//     return uuidv4();
//   }

//   // Validate the structure of the data loaded from config
//   // Derived classes implement their own logic here
//   abstract validateStructure(data: any): boolean;

//   // Parse raw data from config file to object
//   protected abstract parse(rawData: string): object;
//   // Serialize object to string for saving
//   protected abstract serialize(data: object): string;

//   readConfig(): Config {
//     if (!fs.existsSync(this.configPath)) {
//       throw new Error(`Config file not found at: ${this.configPath}`);
//     }
//     const rawData = fs.readFileSync(this.configPath, 'utf-8');
//     const parsedData = this.parse(rawData);
//     if (!this.validateStructure(parsedData)) {
//       throw new Error('Configuration file structure is invalid.');
//     }
//     return parsedData as Config;
//   }

//   writeConfig(data: object): void {
//     const serializedData = this.serialize(data);
//     fs.writeFileSync(this.configPath, serializedData, 'utf-8');
//   }

//   getFilePathById(id: string): string | undefined {
//     const config = this.readConfig();
//     return config["file-paths"]?.[id];
//   }

//   setFilePathById(id: string, filePath: string): void {
//     const config = this.readConfig();
//     if (!config["file-paths"]) {
//       config["file-paths"] = {};
//     }
//     config["file-paths"][id] = filePath;
//     this.writeConfig(config);
//   }

//   removeFilePathById(id: string): void {
//     const config = this.readConfig();
//     if (config["file-paths"] && config["file-paths"][id]) {
//       delete config["file-paths"][id];
//       this.writeConfig(config);
//     }
//   }
// }

interface Config {
    instances?: InstanceConfig[]; // Adjust as needed
    "file-paths"?: { [key: string]: string };
  }
  
  interface InstanceConfig {
    id: string;
    name: string;
    "start-page": string;
    "toc-elements": TocElement[];
  }
  
  interface TocElement {
    id: string;
    topic: string;
    "toc-title": string;
    "sort-children": string;
    children: TocElement[];
  }
  