// // eslint-disable-next-line import/no-unresolved
// import * as vscode from 'vscode';
// import * as path from 'path';
// import { InstanceConfig, TocElement } from '../utils/types';
// import FileService from '../services/fileService';

// export default abstract class AbstractConfigManager {
//   configPath: string;
  
//   instances: InstanceConfig[] = [];

//   constructor(configPath: string) {
//     this.configPath = configPath;
//   }

//   public abstract writeConfig(
//     _doc: InstanceConfig,
//     _filePath?: string
//   ): Promise<void>;

//   abstract getTopicsDir(): string;

//   abstract getImageDir(): string;

//   // Document-specific methods
//   abstract addDocument(newDocument: InstanceConfig): Promise<void>;

//   abstract deleteDocument(docId: string): Promise<boolean>;

//   // Refresh configuration
//   abstract refresh(): Promise<void>;

//   getDocuments(): InstanceConfig[] {
//     return this.instances;
//   }

//   /**
//    * Renames a topic’s file on disk and updates config accordingly.
//    */
//   async renameTopic(
//     oldTopicFile: string,
//     newTopicFile: string,
//     doc: InstanceConfig
//   ): Promise<void> {
//     const topicsDir = this.getTopicsDir();
//     const oldFileUri = vscode.Uri.file(path.join(topicsDir, oldTopicFile));
//     const newFileUri = vscode.Uri.file(path.join(topicsDir, newTopicFile));
//     await vscode.workspace.fs.rename(oldFileUri, newFileUri);
//     await this.writeConfig(doc);
//   }

//   /**
//    * Deletes a topic (and children) -> removes from disk -> updates .tree/config.
//    */
//   async deleteTopic(topicsFilestoBeRemoved: string[], doc: InstanceConfig): Promise<boolean> {
//     const topicsDir = this.getTopicsDir();
//     await Promise.all(
//       topicsFilestoBeRemoved.map(async (tFile) =>
//         FileService.deleteFileIfExists(path.join(topicsDir, tFile))
//       )
//     );
//     await this.writeConfig(doc);
//     return true;

//   }

//   async addChildTopic(
//     newTopic: TocElement,
//     doc: InstanceConfig
//   ): Promise<void> {
//     await this.writeTopicFile(newTopic);
//     const fileExists = await FileService.fileExists(path.join(this.getTopicsDir(), newTopic.topic));
//     if (fileExists) {
//       await this.writeConfig(doc);
//     }
//   }

//   /**
//    * Retrieves the title from a Markdown file’s first heading or uses fallback.
//    */
//   protected async getMdTitle(topicFile: string): Promise<string> {
//     try {
//       const mdFilePath = path.join(this.getTopicsDir(), topicFile);
//       const content = await FileService.readFileAsString(mdFilePath);
//       const lines = content.split('\n');
//       for (let i = 0; i < lines.length; i += 1) {
//         const line = lines[i].trim();
//         if (line.startsWith('# ')) {
//           return line.substring(1).trim();
//         }
//         if (line.length > 0) {
//           break;
//         }
//       }
//     } catch {
//       // ignore
//     }
//     return `<${path.basename(topicFile)}>`;
//   }

//   /**
//    * Writes a new .md file for the topic, if it doesn’t exist.
//    */
//   protected async writeTopicFile(newTopic: TocElement): Promise<void> {
//     try {
//       const topicsDir = this.getTopicsDir();
//       await vscode.workspace.fs.createDirectory(vscode.Uri.file(topicsDir));

//       const filePath = path.join(topicsDir, newTopic.topic);
//       if (await FileService.fileExists(filePath)) {
//         vscode.window.showWarningMessage(`Topic file "${newTopic.topic}" already exists.`);
//         return;
//       }

//       await FileService.writeNewFile(
//         filePath,
//         `# ${newTopic.title}\n\nContent goes here...`
//       );
//       // Optionally open the new file in the editor:
//       await vscode.commands.executeCommand('authordExtension.openMarkdownFile', filePath);
//     } catch (err: any) {
//       vscode.window.showErrorMessage(`Failed to write topic file "${newTopic.topic}": ${err.message}`);
//       throw err;
//     }
//   }
// }
