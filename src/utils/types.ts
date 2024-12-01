export interface Config {
    "topics-dir": string;
    images: ImagesConfig;
    instance: InstanceConfig;
  }
  
  export interface ImagesConfig {
    dir: string;
    version: string;
    "web-path": string;
  }
  
  export interface InstanceConfig {
    id: string;
    name: string;
    "start-page": string;
    "toc-elements": TocElement[];
  }
  
  export interface TocElement {
    id: string;
    topic: string;
    "toc-title": string;
    "sort-children": "ascending" | "descending" | "none";
    children?: TocElement[];
  }
  
  export interface Topic {
    name: string;
    path: string;
  }
  
  export interface TocTreeItem {
    id: string;
    title: string;
    topic?: string;
    filePath?: string;
    sortChildren: "ascending" | "descending" | "none";
    children: TocTreeItem[];
  }  