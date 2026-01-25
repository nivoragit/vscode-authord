# Authord VS Code Extension

Authord is a docs-as-code workflow inside VS Code that keeps documentation close to your repo. It combines topic trees, previews, AI-assisted authoring, indexing with citations, and optional Confluence workflows.

## Key Features

### Available now

- Documentation instances and topic trees driven by `authord.config.json` or `writerside.cfg`.
- Custom Markdown preview with optional docset rendering mode.
- Commit documentation generation with AI assistance.
- Chat participant `@authord` with citations from the local index.
- Vector indexing (local HNSW or Qdrant) with automatic indexing on save.
- Confluence publishing via CLI plus read-only snapshot sync for tri-state comparisons.
- Tri-State registry, drift diagnostics, topic status badges, harmonize workflow, and a tri-pane diff view.
- Run tracking logs for harmonize and sync workflows.
- Optional tools: CI gate (`tools/ci`) and standalone pgvector indexer (`tools/indexer`).

### Planned (Tri-State)

- The Tri-State roadmap lives in `_authord/blueprints/tri-state.blueprint.yaml`. Run `Authord: Generate Tri-State Integration Plan` to produce `docs/architecture/tri-state-integration.md` when you need a current mapping.

## Quick Start (Development Host)

1) Install dependencies:

```
npm install
```

2) Build the extension:

```
npm run compile
```

3) Launch the Extension Development Host:

- Open this repo in VS Code.
- Run `Run > Start Debugging` and choose the extension host.

4) Initialize a docs instance:

- Run `Create a New Project` to generate `authord.config.json`, or
- Open a workspace that already contains `authord.config.json` or `writerside.cfg`.

## Commands

Command name | Command id | What it does
---|---|---
Create a New Project | `extension.createProject` | Creates a new Authord config and documentation instance.
Move Topic | `extension.moveTopic` | Moves a topic within the table of contents.
New | `extension.addDocumentation` | Adds a new documentation instance.
Generate Docs for Current Commit | `authordExtension.generateCommitDocs` | Creates a Markdown doc for the latest Git commit.
Configure AI Provider | `authordExtension.configureAI` | Guides you through AI provider setup.
Authord: Generate Tri-State Integration Plan | `authord.generateTriStateIntegrationPlan` | Scans the repo and writes a tri-state integration plan doc.
Authord: Initialize Tri-State Registry | `authord.initializeRegistry` | Creates or merges the tri-state registry from existing topics.
Authord: Show Topic Status | `authord.showTopicStatus` | Shows the tri-state status for the active topic file.
Authord: Harmonize Topic | `authord.harmonizeTopic` | Runs the harmonize workflow and presents a diff.
Authord: Sync Confluence Snapshots | `authord.syncConfluenceSnapshots` | Fetches read-only Confluence snapshots for topics.
Authord: Open Tri-State Diff | `authord.openTriStateDiff` | Opens the tri-pane diff view for a topic.
Authord: Show Last Run Report | `authord.showLastRunReport` | Opens the most recent workflow run log.
Initialize Tri-State Registry | `authordExtension.initTriStateRegistry` | Bootstraps the registry from the current instance.
Install Codex Skill | `authordExtension.installCodexSkill` | Installs a Codex skill into the local environment.
Publish Docs to Confluence + Index | `authordExtension.publishDocs` | Publishes docs to Confluence and refreshes the index.
Index Documentation | `authordExtension.indexDocs` | Builds or refreshes the local vector index.
Clear Documentation Index | `authordExtension.clearIndex` | Clears the local vector index.
Reload Configuration | `extension.reloadConfiguration` | Reloads Authord configuration files.
New Instance | `extension.addContextMenuDocumentation` | Adds a new documentation instance from the view menu.
Root | `extension.rootTopic` | Adds a root topic to the table of contents.
Collapse All | `workbench.actions.treeView.topicsView.collapseAll` | Collapses the topics tree.
Child | `extension.addChildTopic` | Adds a child topic.
New Topic | `extension.addContextMenuTopic` | Adds a sibling topic.
New Child Topic | `extension.addContextMenuChildTopic` | Adds a child topic from the context menu.
Set as Home Page | `extension.ContextMenuSetasStartPage` | Marks a topic as the start page.
Delete | `extension.deleteTopic` | Deletes a topic.
Remove TOC Element | `extension.deleteContextMenuTopic` | Removes a topic from the TOC.
Edit Title | `extension.renameContextMenuTopic` | Renames a topic.
Delete | `extension.deleteContextMenuDocumentation` | Deletes a documentation instance.
Delete | `extension.deleteDocumentation` | Deletes a documentation instance (inline).
Rename | `extension.renameContextMenuDoc` | Renames a documentation instance.
Rename | `extension.renameDoc` | Renames a documentation instance (inline).
Select Documentation Instance | `authordDocsExtension.selectInstance` | Switches the active documentation instance.
Initialize Authord Extension | `authordDocsExtension.initialize` | Initializes Authord for the selected instance.
Open Markdown File | `authordExtension.openMarkdownFile` | Opens a topic file and refreshes the preview.
Open Markdown Preview | `markdownPreview.open` | Opens the built-in Markdown preview.
Show Markdown Preview | `markdownPreview.show` | Shows the built-in Markdown preview.
Refresh Preview | `authord.refreshPreview` | Refreshes the custom preview.

## Settings

### General and preview

Setting | Default | Description
---|---|---
authord.topics | `[]` | List of topics to display in the tree view.
authord.autoFocusEditor | `true` | Auto-focus the editor when the preview activates.
authord.focusDelay | `500` | Delay in ms before refocusing the editor.
authord.useCustomPreview | `true` | Use the custom preview instead of the built-in preview.
authord.previewRenderMode | `simple` | Preview render mode: `simple` or `docset`.

### AI provider

Setting | Default | Description
---|---|---
authord.ai.provider | `copilot` | AI provider: `copilot`, `vscode`, or `custom`.
authord.ai.vendor | `` | Optional vendor filter for VS Code models.
authord.ai.modelId | `` | Optional model id to pin for VS Code models.
authord.ai.allowModelPicker | `true` | Allow prompting for another model if preferred is unavailable.
authord.ai.custom.baseUrl | `` | Base URL for a custom OpenAI-compatible API.
authord.ai.custom.model | `` | Model name for the custom provider.
authord.ai.custom.chatEndpoint | `` | Full chat endpoint URL override.
authord.ai.custom.embeddingModel | `` | Embedding model name for custom provider.
authord.ai.custom.apiKey | `` | API key for custom provider (prefer env vars).
authord.ai.custom.requestTimeoutMs | `60000` | Request timeout in ms for custom provider.
authord.ai.embeddings.provider | `inherit` | Embedding provider: `inherit`, `custom`, or `local`.

### Logging

Setting | Default | Description
---|---|---
authord.logging.level | `info` | Logging verbosity: `debug`, `info`, `warn`, `error`.
authord.logging.showOnError | `true` | Show the Authord output channel on errors.

### Sentinel (drift detection)

Setting | Default | Description
---|---|---
authord.sentinel.enabled | `true` | Enable quick-mode drift checks on save.
authord.sentinel.mode | `quick` | Drift detection mode: `quick` or `off`.
authord.sentinel.autoMarkRegistry | `false` | Persist DRIFTED status to the registry.

### Confluence

Setting | Default | Description
---|---|---
authord.confluence.mode | `single` | Publish mode: `single` or `tree`.
authord.confluence.enabled | `true` | Enable Confluence publishing features.
authord.confluence.baseUrl | `` | Confluence base URL (or `CONF_BASE_URL`).
authord.confluence.basicAuth | `` | Credentials as `user:token` (or `CONF_BASIC_AUTH`).
authord.confluence.pageId | `` | Target Confluence page ID.
authord.confluence.rootDir | `` | Override project root for publishing.
authord.confluence.cliPath | `authord` | Path to the Authord CLI binary.
authord.confluence.useDeno | `false` | Run a Deno script instead of a compiled CLI.
authord.confluence.denoPath | `deno` | Path to the Deno executable.
authord.confluence.denoScriptPath | `` | Path to the Deno CLI script.
authord.confluence.cfgPath | `` | Explicit writerside.cfg path (relative to root).
authord.confluence.imagesDir | `` | Images directory (relative to root).
authord.confluence.allowRemoteXsd | `false` | Allow remote XSD fetch during validation.
authord.confluence.noToc | `false` | Disable Confluence TOC macro insertion.
authord.confluence.separators | `false` | Insert section separators.
authord.confluence.headingLevel | `2` | Section heading level for publishing.
authord.confluence.title | `` | Optional title override for single-page publish.

### Vector index

Setting | Default | Description
---|---|---
authord.vector.enabled | `true` | Enable vector indexing for agentic search.
authord.vector.autoIndex | `true` | Automatically index on Markdown save.
authord.vector.store | `local-hnsw` | Vector store: `local-hnsw`, `local-json`, or `qdrant`.
authord.vector.topK | `6` | Default number of chunks to retrieve.
authord.vector.chunk.maxChars | `2000` | Maximum characters per chunk.
authord.vector.chunk.overlapChars | `200` | Overlap between adjacent chunks.
authord.vector.embedding.batchSize | `16` | Batch size for embedding requests.
authord.vector.storagePath | `` | Override storage path for the index.
authord.vector.qdrant.baseUrl | `` | Qdrant base URL.
authord.vector.qdrant.collection | `authord_docs` | Qdrant collection name.
authord.vector.qdrant.apiKey | `` | Qdrant API key.
authord.vector.includeConfluenceSnapshots | `false` | Include Confluence snapshots in the index.

### UI

Setting | Default | Description
---|---|---
authord.ui.showTriStateBadges | `true` | Show tri-state badges in the Topics tree.
authord.ui.showTriStateEditorIndicator | `true` | Show tri-state indicators in the editor.

## Workflows / How it works

- Authord reads `authord.config.json` or `writerside.cfg`, then exposes instances and topics in the Authord views.
- Topics are Markdown files that can be opened with a custom preview or the built-in preview.
- Commit docs and harmonize flows use the configured AI provider.
- The vector index powers `@authord` chat responses with citations.
- Tri-State registry and workflows live under `_authord/` and `_authord_output/`:
  - Registry path: `_authord/topics/index.yaml` (created via init commands).
  - Sentinel quick mode detects drift and reports diagnostics.
  - Harmonize creates a draft patch and shows a diff before writing.
  - Confluence snapshots are read-only and stored under `_authord_output/confluence_snapshots/`.
  - Tri-State diff view compares code, local docs, and remote snapshots.
  - Workflow run logs are stored under `_authord/_runs/`.

### Documentation Tree Placement

- `README.md` (this file)
- `_authord/blueprints/tri-state.blueprint.yaml` (tri-state roadmap)
- `tools/indexer/README.md` (standalone pgvector indexer)
- `docs/architecture/tri-state-integration.md` (generated by command when needed)

## Confluence integration

- Publishing uses the Authord CLI (command `Publish Docs to Confluence + Index`). Configure `authord.confluence.baseUrl`, `authord.confluence.basicAuth`, and `authord.confluence.pageId` or set `CONF_BASE_URL` and `CONF_BASIC_AUTH`.
- Snapshot sync (`Authord: Sync Confluence Snapshots`) is read-only and stores versioned JSON in `_authord_output/confluence_snapshots/` for tri-state comparisons.

## Development

- Install dependencies: `npm install`
- Build: `npm run compile` or `npm run watch`
- Lint: `npm run lint`
- Unit tests: `npm run test:unit`
- Extension tests: `npm run test`
- Package: `npm run package`
- CI gate: `npm run authord:ci`
- Standalone indexer: see `tools/indexer/README.md`

## Troubleshooting

- "Config file does not exist": run `Create a New Project` or add `authord.config.json` or `writerside.cfg` at the workspace root.
- Confluence publish or snapshot sync fails: set `authord.confluence.baseUrl` and `authord.confluence.basicAuth` (or `CONF_BASE_URL` and `CONF_BASIC_AUTH`).
- Vector index unavailable: set `authord.vector.enabled` to `false` or use `authord.vector.store=local-json` as a fallback.
- AI errors: verify provider settings and API keys via environment variables.

## License and Contributing

- License: GPL-3.0 (see `LICENSE.txt`).
- Contributing: no contributing guide is documented yet.
