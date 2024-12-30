import { TocElement } from "../configurationManagers/abstractConfigurationManager";

export interface InstanceConfig {
  id: string;
  name: string;
  "start-page": string;
  "toc-elements": TocElement[];
}

export interface Topics {
  "dir": string;
}

export interface TocTreeItem {
  title: string;
  topic: string;
  filePath?: string;
  sortChildren:  string;
  children: TocTreeItem[];
}

