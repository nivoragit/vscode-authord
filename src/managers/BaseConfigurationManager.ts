// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import * as path from 'path';
import { InstanceConfig, TocElement } from '../utils/types';
import FileService from '../services/FileService';

export default abstract class BaseConfigurationManager {
    configPath: string;

    instances: InstanceConfig[] = [];

    constructor(configPath: string) {
        this.configPath = configPath;
    }

    public abstract saveDocumentConfig(
        _doc: InstanceConfig,
        _filePath?: string
    ): Promise<void>;

    abstract getTopicsDirectory(): string;

    abstract getImagesDirectory(): string;

    // Document-specific methods
    abstract createDocument(newDocument: InstanceConfig): Promise<void>;

    abstract removeDocument(docId: string): Promise<boolean>;

    // Refresh configuration
    abstract reloadConfiguration(): Promise<void>;

    fetchAllDocuments(): InstanceConfig[] {
        return this.instances;
    }

    /**
     * Renames a topic’s file on disk and updates config accordingly.
     */
    async renameTopicFile(
        oldTopicFile: string,
        newTopicFile: string,
        doc: InstanceConfig
    ): Promise<void> {
        const topicsDir = this.getTopicsDirectory();
        const oldFileUri = vscode.Uri.file(path.join(topicsDir, oldTopicFile));
        const newFileUri = vscode.Uri.file(path.join(topicsDir, newTopicFile));
        await vscode.workspace.fs.rename(oldFileUri, newFileUri);
        await this.saveDocumentConfig(doc);
    }

    /**
     * Deletes one or more topic files -> removes from disk -> updates .tree/config.
     */
    async removeTopicFiles(topicsFilestoBeRemoved: string[], doc: InstanceConfig): Promise<boolean> {
        const topicsDir = this.getTopicsDirectory();
        await Promise.all(
            topicsFilestoBeRemoved.map(async (tFile) =>
                FileService.deleteFileIfExists(path.join(topicsDir, tFile))
            )
        );
        await this.saveDocumentConfig(doc);
        return true;
    }

    /**
     * Adds a new child topic (and file) -> updates config if file is created.
     */
    async createChildTopicFile(
        newTopic: TocElement,
        doc: InstanceConfig
    ): Promise<void> {
        await this.createTopicMarkdownFile(newTopic);
        const fileExists = await FileService.fileExists(path.join(this.getTopicsDirectory(), newTopic.topic));
        if (fileExists) {
            await this.saveDocumentConfig(doc);
        }
    }

    /**
     * Retrieves the title from a Markdown file’s first heading or uses fallback.
     */
    protected async extractMarkdownTitle(topicFile: string): Promise<string> {
        try {
            const mdFilePath = path.join(this.getTopicsDirectory(), topicFile);
            const content = await FileService.readFileAsString(mdFilePath);
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i += 1) {
                const line = lines[i].trim();
                if (line.startsWith('# ')) {
                    return line.substring(1).trim();
                }
                if (line.length > 0) {
                    break;
                }
            }
        } catch {
            // ignore
        }
        return `<${path.basename(topicFile)}>`;
    }

    public async updateMarkdownTitle(topicFile: string, newTitle: string): Promise<void> {
        const mdFilePath = path.join(this.getTopicsDirectory(), topicFile);
      
        await FileService.updateFile(mdFilePath, (content) => {
          const lines = content.split('\n');
          
          for (let i = 0; i < lines.length; i += 1) {
            if (lines[i].trim().startsWith('# ')) {
              lines[i] = `# ${newTitle}`;
              return lines.join('\n');
            }
            if (lines[i].trim().length > 0) break;
          }
      
          // No title found, prepend it
          return `# ${newTitle}\n${content}`;
        });
      }
      


    /**
     * Writes a new .md file for the topic, if it doesn’t exist.
     */
    protected async createTopicMarkdownFile(newTopic: TocElement): Promise<void> {
        try {
            const topicsDir = this.getTopicsDirectory();
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(topicsDir));

            const filePath = path.join(topicsDir, newTopic.topic);
            if (await FileService.fileExists(filePath)) {
                vscode.window.showWarningMessage(`Topic file "${newTopic.topic}" already exists.`);
                return;
            }

            await FileService.writeNewFile(
                filePath,
                `# ${newTopic.title}\n\nContent goes here...`
            );
            // Optionally open the new file in the editor:
            await vscode.commands.executeCommand('authordExtension.openMarkdownFile', filePath);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to write topic file "${newTopic.topic}": ${err.message}`);
            throw err;
        }
    }
}
