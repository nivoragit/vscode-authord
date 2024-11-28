import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Initial state
let configExists = false;
let wJetFocus = false;
// Getter function
export function getConfigExists(): boolean {
  return configExists;
}
// Setter function
export function setConfigExists(value: boolean): void {
  configExists = value;
  vscode.commands.executeCommand('setContext', 'writerjet.configExists', value);
}
// Getter function
export function getwJetFocus(): boolean {
  return wJetFocus;
}
// Setter function
export function setwJetFocus(value: boolean): void {
  wJetFocus = value;
  
}