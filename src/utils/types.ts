export interface Config {
    "topics": Topics;
    images: ImagesConfig;
    instances: InstanceConfig[];
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
  export interface Topics {
    "dir": string;
  }

  export interface TocTreeItem {
    id: string;
    title: string;
    topic?: string;
    filePath?: string;
    sortChildren: "ascending" | "descending" | "none";
    children: TocTreeItem[];
  }  

  export interface IhpData {
    topics: { dir: string };
    images: { dir: string; webPath: string };
    instanceFiles: string[];
  }
  export interface TreeData {
    id: string;
    name: string;
    startPage: string;
    tocElements: TocElement[];
  }
  

    