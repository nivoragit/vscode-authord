import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Ajv, ErrorObject, JSONSchemaType } from 'ajv';

interface Configuration {
    settingOne: string;
    settingTwo: number;
}

export async function readConfiguration() {
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder is open.');
        return;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const configFilePath = path.join(workspaceRoot, 'writerside.config.json');

    if (!fs.existsSync(configFilePath)) {
        vscode.window.showWarningMessage('Configuration file not found in the project root.');
        return;
    }

    try {
        const fileContent = fs.readFileSync(configFilePath, 'utf8');
        const config: unknown = JSON.parse(fileContent);

        const schema: JSONSchemaType<Configuration> = {
            type: 'object',
            properties: {
                settingOne: { type: 'string' },
                settingTwo: { type: 'number' },
            },
            required: ['settingOne', 'settingTwo'],
            additionalProperties: false,
        };

        const ajv = new Ajv();
        const validate = ajv.compile(schema);

        if (!validate(config)) {
            const errors = validate.errors
    ?.map((err: ErrorObject) => `${err.instancePath || '/'} ${err.message}`)
    .join(', ');
            vscode.window.showErrorMessage(`Configuration validation failed: ${errors}`);
            return;
        }

        vscode.window.showInformationMessage('Configuration loaded and validated successfully.');
    } catch (error) {
        if (error instanceof Error) {
            vscode.window.showErrorMessage(`Error reading configuration: ${error.message}`);
        } else {
            vscode.window.showErrorMessage('An unknown error occurred while reading the configuration.');
        }
    }
}
