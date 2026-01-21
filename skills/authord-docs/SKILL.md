---
name: authord-docs
description: Authord docs-as-code assistant for generating or updating Markdown docs, outlines, commit summaries, and doc tree placement guidance. Use when the user asks for Authord documentation, docs alongside code, Writerside/Confluence-style guidance, or an Authord-specific documentation template.
---

# Authord Docs

## Overview

Provide Authord-specific documentation help that is structured, concise, and ready to drop into a Markdown file. Mirror the Authord chat participant behavior so Codex can deliver the same output format.

## Workflow

1. Collect context from the user prompt. If code or file context is missing, ask for a snippet or file path before drafting detailed docs.
2. Identify the document intent:
   - Commit doc (recent change summary)
   - Feature or component doc
   - How-to or configuration guide
3. Respond in two sections, always in this order:
   - Future Authord (full version)
   - Authord (demo) today
4. In the demo section, output a Markdown outline or full draft that:
   - Starts with a single H1
   - Mentions a proposed Markdown file name or path
   - Includes a "Documentation Tree Placement" section
   - Uses ASCII only (no smart quotes or emojis)
5. Never claim to update external systems. Only describe external actions in the Future Authord section.

## Response Format

Use this structure verbatim:

Future Authord (full version)
- Bullet list (2-5 items) describing what a fully integrated Authord would do at this step.

Authord (demo) today
- If code context is missing, start with a short note asking for a snippet.
- Provide a Markdown outline or full doc draft with suggested file name.

## Commit Doc Guidance

When summarizing commits:
- Analyze test context first, then code diffs, then other files.
- Call out user-facing impact, API/CLI/config changes, and testing gaps.
- Suggest where the page should live in the Authord TOC.

## Quality Rules

- Keep responses concise and engineer-focused.
- Prefer clear section headers and bullet lists over long paragraphs.
- Propose follow-up questions only when needed.
