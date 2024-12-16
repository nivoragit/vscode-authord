import { AbstractConfigManager } from "./abstractConfigManager";


interface TocElement {
  id: string;
  topic: string;
  "toc-title": string;
  "sort-children": string;
  children: TocElement[];
}

interface InstanceConfig {
  id: string;
  name: string;
  "start-page": string;
  "toc-elements": TocElement[];
}

interface JSONConfig {
  instances: InstanceConfig[];
  "file-paths"?: { [key: string]: string };
  [key: string]: any;
}

export class JSONConfigurationManager extends AbstractConfigManager {

  validateStructure(data: any): boolean {
    // Basic validation: Check if instances is an array
    return Array.isArray(data.instances);
  }

  // Document Methods
  addDocument(newDocument: object): void {
    const config = this.readConfig() as JSONConfig;
    config.instances.push(newDocument as InstanceConfig);
    this.writeConfig(config);
  }

  deleteDocument(docId: string): void {
    const config = this.readConfig() as JSONConfig;
    config.instances = config.instances.filter(doc => doc.id !== docId);
    this.writeConfig(config);
  }

  renameDocument(docId: string, newName: string): void {
    const config = this.readConfig() as JSONConfig;
    const doc = config.instances.find(d => d.id === docId);
    if (doc) {
      doc.name = newName;
      this.writeConfig(config);
    } else {
      throw new Error(`Document with ID ${docId} not found.`);
    }
  }

  // Topic Methods
  addTopic(parentTopicId: string | null, newTopic: object): void {
    const config = this.readConfig() as JSONConfig;
    // Assume a single active document or handle multiple as needed
    // For simplicity, we’ll add to the first document found
    const doc = config.instances[0];
    if (!doc) {
      throw new Error('No document available to add a topic to.');
    }

    if (parentTopicId === null) {
      doc["toc-elements"].push(newTopic as TocElement);
    } else {
      const parent = this.findTopicById(doc["toc-elements"], parentTopicId);
      if (!parent) {throw new Error(`Parent topic with ID ${parentTopicId} not found.`);}
      parent.children.push(newTopic as TocElement);
    }
    this.writeConfig(config);
  }

  deleteTopic(topicId: string): void {
    const config = this.readConfig() as JSONConfig;
    const doc = config.instances[0];
    if (!doc) {return;}

    this.removeTopicById(doc["toc-elements"], topicId);
    this.writeConfig(config);
  }

  renameTopic(topicId: string, newName: string): void {
    const config = this.readConfig() as JSONConfig;
    const doc = config.instances[0];
    if (!doc) {return;}

    const topic = this.findTopicById(doc["toc-elements"], topicId);
    if (!topic) {throw new Error(`Topic with ID ${topicId} not found.`);}
    topic["toc-title"] = newName;
    this.writeConfig(config);
  }

  moveTopic(topicId: string, newParentId: string | null): void {
    const config = this.readConfig() as JSONConfig;
    const doc = config.instances[0];
    if (!doc) {return;}

    // Remove the topic from current location
    const topic = this.extractTopicById(doc["toc-elements"], topicId);
    if (!topic) {throw new Error(`Topic with ID ${topicId} not found.`);}

    // Insert into new parent or root
    if (newParentId === null) {
      doc["toc-elements"].push(topic);
    } else {
      const parent = this.findTopicById(doc["toc-elements"], newParentId);
      if (!parent) {throw new Error(`Parent topic with ID ${newParentId} not found.`);}
      parent.children.push(topic);
    }
    this.writeConfig(config);
  }

  refresh(): void {
    this.readConfig(); // Just reloading config into memory
  }

  protected parse(rawData: string): object {
    return JSON.parse(rawData);
  }

  protected serialize(data: object): string {
    return JSON.stringify(data, null, 2);
  }

  private findTopicById(topics: TocElement[], id: string): TocElement | undefined {
    for (const t of topics) {
      if (t.id === id) {return t;}
      const found = this.findTopicById(t.children, id);
      if (found) {return found;}
    }
    return undefined;
  }

  private removeTopicById(topics: TocElement[], id: string): boolean {
    const index = topics.findIndex(t => t.id === id);
    if (index > -1) {
      topics.splice(index, 1);
      return true;
    }
    for (const t of topics) {
      if (this.removeTopicById(t.children, id)) {return true;}
    }
    return false;
  }

  private extractTopicById(topics: TocElement[], id: string): TocElement | null {
    const index = topics.findIndex(t => t.id === id);
    if (index > -1) {
      const [removed] = topics.splice(index, 1);
      return removed;
    }
    for (const t of topics) {
      const extracted = this.extractTopicById(t.children, id);
      if (extracted) {return extracted;}
    }
    return null;
  }
}
