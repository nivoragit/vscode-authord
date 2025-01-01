export abstract class AbstractConfigManager {
  configPath: string;
    instances: InstanceConfig[] | undefined;

  constructor(configPath: string) {
    this.configPath = configPath;
  }
  abstract validateAgainstSchema(schemaPath: string):Promise<void>;
  abstract getTopicsDir(): string;
  abstract getImageDir(): string;
  // Document-specific methods
  abstract addDocument(newDocument: InstanceConfig):void;
  abstract deleteDocument(docId: string): void;
  abstract renameDocument(docId: string, newName: string): void;
  abstract getDocuments(): InstanceConfig[];
  // abstract loadInstances(): Promise<void>;

  // Topic-specific methods
  abstract addTopic(docId: string, parentTopicId: string | null, newTopic: TocElement):  Promise<void>;
  abstract deleteTopic(docId: string, topicId: string): Promise<void>;
  abstract renameTopic(docId: string, topicId: string, newName: string): Promise<void>;
  abstract getTopics():  Promise<Topic[]>;

  // Refresh configuration
  abstract refresh(): Promise<void>;

  // New file and directory operations
  abstract createDirectory(dirPath: string): Promise<void>;
}


export interface InstanceConfig {
  id: string;
  name: string;
  "start-page": string;
  "toc-elements": TocElement[];
}

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

