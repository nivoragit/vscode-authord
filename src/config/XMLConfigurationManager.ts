import { AbstractConfigManager } from './abstractConfigManager';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

interface TocElement {
  topic: string;
  'toc-element'?: TocElement[];
}

interface InstanceProfile {
  "@_id": string;
  "@_name": string;
  "@_start-page": string;
  "toc-element": TocElement[];
}

interface XMLConfig {
  "instance-profile": InstanceProfile;
  "file-paths"?: { [key: string]: string };
}

export class XMLConfigurationManager extends AbstractConfigManager {
  validateStructure(data: any): boolean {
    // Check if data has 'instance-profile' at minimum
    return data && data["instance-profile"];
  }

  // Document Methods
  addDocument(newDocument: object): void {
    // For now, assume one instance-profile; in the future, extend to multiple
    const config = this.readConfig() as XMLConfig;
    // Extend logic here if multiple instance-profiles are to be supported
    // Example: if config is designed to hold multiple <instance-profile>, 
    // wrap them in a root element and handle accordingly.
    config["instance-profile"] = newDocument as InstanceProfile;
    this.writeConfig(config);
  }

  deleteDocument(docId: string): void {
    const config = this.readConfig() as XMLConfig;
    // If multiple documents, remove the one with docId.
    // Currently one doc: if the IDs match, remove by resetting
    if (config["instance-profile"] && config["instance-profile"]["@_id"] === docId) {
      delete config["instance-profile"];
    }
    this.writeConfig(config);
  }

  renameDocument(docId: string, newName: string): void {
    const config = this.readConfig() as XMLConfig;
    if (config["instance-profile"] && config["instance-profile"]["@_id"] === docId) {
      config["instance-profile"]["@_name"] = newName;
      this.writeConfig(config);
    } else {
      throw new Error(`Document with ID ${docId} not found.`);
    }
  }

  // Topic Methods
  addTopic(parentTopicId: string | null, newTopic: object): void {
    const config = this.readConfig() as XMLConfig;
    const doc = config["instance-profile"];
    if (!doc) {throw new Error('No instance-profile to add topic to.');}

    const toc = doc["toc-element"] || [];
    if (parentTopicId === null) {
      toc.push(newTopic as TocElement);
    } else {
      const parent = this.findTopicById(toc, parentTopicId);
      if (!parent) {throw new Error(`Parent topic ${parentTopicId} not found.`);}
      if (!parent["toc-element"]) {parent["toc-element"] = [];}
      parent["toc-element"].push(newTopic as TocElement);
    }

    doc["toc-element"] = toc;
    this.writeConfig(config);
  }

  deleteTopic(topicId: string): void {
    const config = this.readConfig() as XMLConfig;
    const doc = config["instance-profile"];
    if (!doc) {return;}

    this.removeTopicById(doc["toc-element"], topicId);
    this.writeConfig(config);
  }

  renameTopic(topicId: string, newName: string): void {
    const config = this.readConfig() as XMLConfig;
    const doc = config["instance-profile"];
    if (!doc) {return;}

    const topic = this.findTopicById(doc["toc-element"], topicId);
    if (!topic) {throw new Error(`Topic with ID ${topicId} not found.`);}
    topic.topic = newName; // Renaming topic means updating the 'topic' attribute
    this.writeConfig(config);
  }

  moveTopic(topicId: string, newParentId: string | null): void {
    const config = this.readConfig() as XMLConfig;
    const doc = config["instance-profile"];
    if (!doc) {return;}

    const topic = this.extractTopicById(doc["toc-element"], topicId);
    if (!topic) {throw new Error(`Topic with ID ${topicId} not found.`);}

    if (newParentId === null) {
      doc["toc-element"].push(topic);
    } else {
      const parent = this.findTopicById(doc["toc-element"], newParentId);
      if (!parent) {throw new Error(`Parent topic with ID ${newParentId} not found.`);}
      if (!parent["toc-element"]) {parent["toc-element"] = [];}
      parent["toc-element"].push(topic);
    }
    this.writeConfig(config);
  }

  refresh(): void {
    this.readConfig();
  }

  protected parse(rawData: string): object {
    const parser = new XMLParser({ ignoreAttributes: false });
    const data = parser.parse(rawData);
    return data;
  }

  protected serialize(data: object): string {
    const builder = new XMLBuilder({ ignoreAttributes: false });
    return builder.build(data);
  }

  private findTopicById(topics: TocElement[], id: string): TocElement | undefined {
    // In XML, we don't have an explicit 'id' attribute for each topic as shown previously.
    // This logic would need an approach to map topics to IDs.
    // For now, assume that 'topic' attribute contains something we can match against 'id'
    // or we maintain a separate mapping in file-paths or an internal structure.

    // Adjust logic as needed to match the actual XML structure for IDs.
    for (const t of topics) {
      if (this.extractIdFromTopic(t.topic) === id) {return t;}
      if (t["toc-element"]) {
        const found = this.findTopicById(t["toc-element"], id);
        if (found) {return found;}
      }
    }
    return undefined;
  }

  private removeTopicById(topics: TocElement[], id: string): boolean {
    const idx = topics.findIndex(t => this.extractIdFromTopic(t.topic) === id);
    if (idx > -1) {
      topics.splice(idx, 1);
      return true;
    }
    for (const t of topics) {
      if (t["toc-element"] && this.removeTopicById(t["toc-element"], id)) {return true;}
    }
    return false;
  }

  private extractTopicById(topics: TocElement[], id: string): TocElement | null {
    const idx = topics.findIndex(t => this.extractIdFromTopic(t.topic) === id);
    if (idx > -1) {
      const [removed] = topics.splice(idx, 1);
      return removed;
    }
    for (const t of topics) {
      if (t["toc-element"]) {
        const extracted = this.extractTopicById(t["toc-element"], id);
        if (extracted) {return extracted;}
      }
    }
    return null;
  }

  private extractIdFromTopic(topic: string): string {
    // Placeholder logic: Extracting ID from topic filename or a known pattern.
    // Adjust according to actual ID assignment logic.
    // E.g., if topic is "t1.md", and we have a mapping in file-paths:
    // We can cross-reference it using getFilePathById() or maintain a separate map.
    return topic.replace('.md', '');
  }
}
