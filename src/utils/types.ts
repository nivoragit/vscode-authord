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