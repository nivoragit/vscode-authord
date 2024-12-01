# Authord Docs Extension

This VS Code extension reads an `authord.json` configuration file and displays documentations and topics in the Activity Bar.

## Features

- **Documentations Tree View**: Lists documentation instances defined in `authord.json`.
- **Topics Tree View**: Displays topics corresponding to the selected documentation instance.
- **Dynamic Updates**: Reflects changes in the topics directory and configuration file in real-time.
- **Open Topics**: Click on a topic to open its Markdown file in the editor.

## Requirements

- An `authord.json` file at the root of your workspace.
- A topics directory containing Markdown files, as specified in `authord.json`.

## Extension Settings

This extension does not contribute any settings.

## Known Issues

- Currently supports only one instance in `authord.json`. Future updates may include support for multiple instances.

## Release Notes

### 1.0.0

- Initial release of Authord Docs Extension.
