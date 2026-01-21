# Authord VSCode Extension

Authord _(pronounced "Author-ed")_ brings documentation-as-code to Visual Studio Code, enabling a structured and efficient workflow for managing technical documentation alongside your code. It offers powerful features similar to JetBrains Writerside, tailored specifically for VSCode users.

## Features

- **Organized Documentation Management**: Maintain clear, structured documentation within your development workflow.
- **Commit Documentation Generation**: Create a Markdown doc for the latest Git commit with one command.
- **AI-Assisted Authoring**: Use VS Code language models (Copilot or other installed models) to generate docs.
- **Agentic Doc Search**: Index docs into a local vector store and answer chat questions with sourced context.
- **Confluence Publish + Index**: Publish docs to Confluence and refresh the vector index in one command.
- **Seamless Navigation**: Easily browse and access documentation without disrupting your coding process.
- **Automated Synchronization**: Keep documentation up to date with minimal effort.
- **Effortless Editing**: Quickly open and modify documentation files with built-in support.
- **Enhanced Productivity**: Utilize live previews, scroll sync, and intuitive controls for a smooth documentation experience.

## Getting Started

1. Install the Authord extension in VS Code.
2. Click the Authord icon in the Activity Bar to create and manage documentation instances.

## Commit Documentation

After you commit code changes, you can generate documentation for the current commit:

1. Run `Authord: Generate Docs for Current Commit` from the Command Palette or the Instances view.
2. If your code is in a different folder than your docs, Authord prompts you to pick the project root and remembers it.
3. Authord analyzes test files first, then the code diff, and produces a new Markdown topic in your documentation tree.

Requires a Git repository with at least one commit.

## Agentic Documentation Search

Authord can index your documentation into a local vector store and use that index to answer chat questions.
The index updates on Markdown save by default, and you can rebuild or clear it manually.

Commands:
- `Authord: Index Documentation`
- `Authord: Clear Documentation Index`

## Confluence Publish + Index

Authord can publish docs to Confluence using the Authord CLI and refresh the vector index in one command:

- `Authord: Publish Docs to Confluence + Index`

This runs a full index update first and then invokes the Authord CLI (single page or tree mode).

## AI Model Settings

Authord uses VS Code language models (or a custom OpenAI-compatible endpoint) to generate documentation.
You can configure this via Settings under `Authord > AI` or run the command `Authord: Configure AI Provider`
to walk through provider setup (Copilot, VS Code models, or custom DeepSeek-style endpoints).

### Copilot (default)

```json
"authord.ai.provider": "copilot",
"authord.ai.allowModelPicker": true
```

- If Copilot is unavailable and model picker is enabled, Authord prompts you to select another installed model.
- Use `authord.ai.vendor` or `authord.ai.modelId` to pin a specific VS Code model.

### VS Code models (including Codex)

If you have Codex (or another model) available through VS Code's model providers, point Authord at it:

```json
"authord.ai.provider": "vscode",
"authord.ai.vendor": "copilot",
"authord.ai.modelId": ""
```

Notes:
- The `vendor` and `modelId` values are examples. Use the exact IDs reported by the VS Code model provider you installed.
- The OpenAI Codex extension (publisher `openai`, extension id `openai.chatgpt`) does not currently register a VS Code language model provider, so it will not appear in the model picker. Use the custom provider settings instead.
- If you leave `vendor`/`modelId` empty, Authord tries all installed models and uses the first available.

### Custom OpenAI-compatible endpoint (DeepSeek example)

Use this when you want to target a self-hosted or third-party OpenAI-compatible API:

```json
"authord.ai.provider": "custom",
"authord.ai.custom.baseUrl": "https://api.deepseek.com",
"authord.ai.custom.model": "deepseek-reasoner",
"authord.ai.custom.apiKey": "YOUR_API_KEY"
```

Notes:
- Keep API keys out of your repo. Prefer environment variables like `AUTHORD_AI_API_KEY`, `DEEPSEEK_API_KEY`, or `OPENAI_API_KEY`.
- If your provider expects a `/v1` prefix, include it in `authord.ai.custom.baseUrl` (e.g., `https://api.example.com/v1`).
- The configuration command includes a DeepSeek preset to prefill the base URL and model.

Example for OpenAI/Codex-style endpoints:

```json
"authord.ai.provider": "custom",
"authord.ai.custom.baseUrl": "https://api.openai.com/v1",
"authord.ai.custom.model": "<your-model-id>"
```

## Embeddings Settings (optional)

By default, Authord uses the custom chat provider for embeddings (when `authord.ai.provider` is `custom`) or a local hash embedding fallback.
You can override the embedding provider explicitly:

```json
"authord.ai.embeddings.provider": "custom"
```

### Custom OpenAI-compatible embeddings

```json
"authord.ai.custom.embeddingModel": "text-embedding-3-small"
```

If `authord.ai.custom.embeddingModel` is not set, Authord uses the chat model for embeddings.

Custom provider overrides:

```json
"authord.ai.custom.chatEndpoint": "https://api.deepseek.com/v1/chat/completions",
"authord.ai.custom.requestTimeoutMs": 60000
```

Notes:
- If `authord.ai.custom.chatEndpoint` is set, it is used directly.
- If the base URL has no path (e.g., `https://api.deepseek.com`), Authord inserts `/v1/chat/completions`.

### Local embeddings (hash fallback)

```json
"authord.ai.embeddings.provider": "local"
```

## Vector Index Settings

```json
"authord.vector.enabled": true,
"authord.vector.autoIndex": true,
"authord.vector.store": "local-hnsw",
"authord.vector.topK": 6,
"authord.vector.chunk.maxChars": 2000,
"authord.vector.chunk.overlapChars": 200,
"authord.vector.embedding.batchSize": 16,
"authord.vector.storagePath": ""
```

Vector store options:
- `local-hnsw` (default, uses hnswlib-node)
- `local-json` (fallback, slower but zero native deps)
- `qdrant` (set Qdrant settings below)

### Qdrant settings

```json
"authord.vector.qdrant.baseUrl": "https://<cluster>.qdrant.io",
"authord.vector.qdrant.collection": "authord_docs",
"authord.vector.qdrant.apiKey": ""
```

## Confluence Publish Settings

These settings control the Confluence CLI invocation used by `Authord: Publish Docs to Confluence + Index`.

```json
"authord.confluence.enabled": true,
"authord.confluence.mode": "single",
"authord.confluence.baseUrl": "https://<your-confluence-domain>",
"authord.confluence.basicAuth": "user:token",
"authord.confluence.pageId": "123456",
"authord.confluence.rootDir": "",
"authord.confluence.cliPath": "authord",
"authord.confluence.useDeno": false,
"authord.confluence.denoPath": "deno",
"authord.confluence.denoScriptPath": "",
"authord.confluence.cfgPath": "",
"authord.confluence.imagesDir": "",
"authord.confluence.allowRemoteXsd": false,
"authord.confluence.noToc": false,
"authord.confluence.separators": false,
"authord.confluence.headingLevel": 2,
"authord.confluence.title": ""
```

Notes:
- `authord.confluence.useDeno` uses a Deno script (e.g., `/path/to/authord/lib/cli.ts`) instead of a compiled binary.
- `authord.confluence.rootDir` defaults to your workspace root if empty.

## Logging Settings

Use the Authord output channel for detailed logs:

```json
"authord.logging.level": "info",
"authord.logging.showOnError": true
```

## Codex Skill (optional)

If you use the Codex CLI, you can install the `authord-docs` skill to get the same Authord response format
outside VS Code. The repo includes the skill at `skills/authord-docs/SKILL.md`. You can:

- Run `Authord: Install Codex Skill` to copy it into `$CODEX_HOME/skills/authord-docs` (fallback: `~/.codex`).
- Or copy it manually if you prefer.

## Writerside Compatibility

Authord allows you to continue working on JetBrains Writerside projects within VS Code. While new Writerside projects cannot be created in Authord, existing projects can be easily maintained and updated within the extension.

## Known Limitations

- Currently, only a single instance per directory is supported. Multi-instance support is under development.

## Receiving Help

If you need assistance, you can:
- Open an issue on our [GitHub repository](https://github.com/nivoragit/vscode-authord/issues)
- Email us at [support@authord.org](mailto:support@authord.org)

## License

**"Writerside"** is a trademark of [JetBrains s.r.o.](https://www.jetbrains.com/).

Authord is distributed under the AGPL-3.0 license.

See [LICENSE](https://github.com/nivoragit/vscode-authord/blob/master/LICENSE.txt) for more information.
