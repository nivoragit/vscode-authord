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

export interface InstanceProfile {
  id: string;
  name: string;
  'start-page'?: string;
  'toc-elements': TocElement[];
}

export interface WriterSideInstanceProfile extends InstanceProfile {
  filePath: string;
}

export interface AuthordConfig {
  topics?: { dir: string };
  images?: { dir: string; version?: string; 'web-path'?: string };
  instances?: InstanceProfile[];
  [key: string]: any;
}
