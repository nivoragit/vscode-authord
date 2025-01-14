export interface TocElement {
  topic: string; // The filename for the topic, e.g., "example.md"
  title: string; // The display title of the topic
  children: TocElement[]; // Nested child topics
}
export interface InstanceConfig {
  id: string;
  name: string;
  "start-page": string;
  "toc-elements": TocElement[];
}
export interface Topic {
  name: string;
  path: string;
}