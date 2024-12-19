import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';


export abstract class AbstractConfigManager {
  configPath: string;

  constructor(configPath: string) {
    this.configPath = configPath;
  }
  abstract getTopicsDir(): string;
  // Document-specific methods
  abstract addDocument(newDocument: any):void;
  abstract deleteDocument(docId: string): void;
  abstract renameDocument(docId: string, newName: string): void;
  abstract getDocuments(): any[];
  abstract loadInstances(): InstanceConfig[];

  // Topic-specific methods
  abstract addTopic(docId: string, parentTopicId: string | null, newTopic: any): void;
  abstract deleteTopic(docId: string, topicId: string): void;
  abstract renameTopic(docId: string, topicId: string, newName: string): void;
  abstract moveTopic(docId: string, topicId: string, newParentId: string | null): void;
  abstract getTopics(): any[];

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

interface Config {
  instances?: InstanceConfig[]; // Adjust as needed
  "file-paths"?: { [key: string]: string };
}


export interface InstanceConfig {
  id: string;
  name: string;
  "start-page": string;
  "toc-elements": TocElement[];
}

// export interface TocElement {
//   id: string;
//   topic: string;
//   "toc-title": string;
//   "sort-children": string;
//   children: TocElement[];
// }
export interface TocElement {
  topic: string; // The filename for the topic, e.g., "example.md"
  title: string; // The display title of the topic
  sortChildren: string; // Sorting behavior for child topics
  children: TocElement[]; // Nested child topics
}
export interface Topic {
  name: string;
  path: string;
}

