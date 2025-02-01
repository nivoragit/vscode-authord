export interface Topic {
  name: string;
  path: string;
}

export interface TocElement {
  topic: string;
  title: string;
  children: TocElement[];
  parent?: TocElement;
}

export interface InstanceConfig {
  id: string;
  name: string;
  'start-page'?: string;
  'toc-elements': TocElement[];
}

export interface AuthordConfig {
  topics?: { dir: string };
  images?: { dir: string; version?: string; 'web-path'?: string };
  instances?: InstanceConfig[];
  [key: string]: any;
}
