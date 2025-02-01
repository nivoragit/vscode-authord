// /* eslint-disable no-param-reassign, no-useless-constructor, @typescript-eslint/no-unused-vars */
// import * as path from 'path';
// import Ajv from 'ajv';
// import { InstanceConfig, TocElement } from '../utils/types';
// import FileService from '../services/fileService';
// import AbstractConfigManager from './AbstractConfigManager';
// import TopicsService from '../services/TopicsService';

// export interface AuthordConfig {
//   topics?: { dir: string };
//   images?: { dir: string; version?: string; 'web-path'?: string };
//   instances?: InstanceConfig[];
//   [key: string]: any;
// }

// export default class AuthordConfigurationManager extends AbstractConfigManager {
//   public configData: AuthordConfig | undefined;

//   constructor(configPath: string) {
//     super(configPath);
//   }

//   async refresh(): Promise<void> {
//     this.configData = await this.readConfig();
//     if (!this.configData) {
//       return;
//     }
//     if (this.configData.instances) {
//       // Load titles from each topic’s .md file
//       await Promise.all(
//         this.configData.instances.map(async (inst: InstanceConfig) => {
//           await Promise.all(
//             inst['toc-elements'].map(async (element: TocElement) => {
//               if (element.topic) {
//                 element.title = await this.getMdTitle(element.topic);
//               }
//             })
//           );
//         })
//       );
//     }
//     this.instances = this.configData.instances || [];
//   }

  // async createConfigFile(): Promise<AuthordConfigurationManager> {
  //   this.configData = AuthordConfigurationManager.defaultConfigJson();
  //   await this.writeConfig();
  //   return this;

  // }

//   static defaultConfigJson(): AuthordConfig {
//     return {
//       schema: 'https://json-schema.org/draft/2020-12/schema',
//       title: 'Authord Settings',
//       type: 'object',
//       topics: { dir: 'topics' },
//       images: { dir: 'images', version: '1.0', 'web-path': 'images' },
//       instances: [],
//     };
//   }

//   private async readConfig(): Promise<AuthordConfig | undefined> {
//     if (!(await FileService.fileExists(this.configPath))) {
//       return undefined;
//     }
//     return FileService.readJsonFile(this.configPath);

//   }

//   public async writeConfig(): Promise<void> {

//     if (!this.configData) {
//       return;
//     }
//     await FileService.updateJsonFile(this.configPath, () => this.configData!);
//   }

//   getTopicsDir(): string {
//     return path.join(
//       path.dirname(this.configPath),
//       this.configData?.topics?.dir || 'topics'
//     );
//   }

//   getImageDir(): string {
//     return path.join(
//       path.dirname(this.configPath),
//       this.configData?.images?.dir || 'images'
//     );
//   }

//   async addDocument(newDocument: InstanceConfig): Promise<void> {
//     if (!this.configData) {
//       return;
//     }
//     this.instances.push(newDocument);

//     const [firstTopic] = newDocument['toc-elements'];
//     if (firstTopic) {
//       await this.writeTopicFile(firstTopic);
//     }

//     if (firstTopic &&
//       (await FileService.fileExists(path.join(this.getTopicsDir(), firstTopic.topic)))
//     ) {
//       // Persist changes to config
//       this.configData.instances = this.instances;
//       await this.writeConfig();
//     }

//   }

//   async deleteDocument(docId: string): Promise<boolean> {
//     const foundDoc = this.instances.find((d: InstanceConfig) => d.id === docId);
//     if (!foundDoc || !this.configData) {
//       return false;
//     }
//     const topicsDir = this.getTopicsDir();
//     const allTopics = TopicsService.getAllTopicsFromTocElement(foundDoc['toc-elements']);
//     await Promise.all(
//       allTopics.map(async (topicFileName: string) => {
//         await FileService.deleteFileIfExists(
//           path.join(topicsDir, topicFileName)
//         );
//       })
//     );
//     this.instances = this.instances.filter((doc) => doc.id !== docId);
//     this.configData.instances = this.instances;
//     await this.writeConfig();
//     return true;

//   }
// }
