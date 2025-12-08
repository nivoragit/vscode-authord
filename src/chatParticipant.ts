import * as vscode from 'vscode';

export function registerAuthordChatParticipant(context: vscode.ExtensionContext) {
    const participant = vscode.chat.createChatParticipant(
        'authord.chat', // 👈 must match package.json id
        async (request, chatContext, stream, token) => {
            stream.progress('Thinking about documentation...');

            const systemPrompt = `You are Authord (Demo), a documentation expert embedded in VS Code.

This is a **demo version** of Authord. You do NOT have live access to Confluence, Git, or any external systems yet.

For every answer, always respond in two clearly separated parts:

1. "Future Authord (full version)"
   - Briefly explain (in 2–5 bullet points) what a future, fully integrated Authord would do at this exact step.
   - Be concrete and forward-looking, for example:
     - Detecting drift between code, local docs, and Confluence.
     - Proposing tri-state sync actions (update local Markdown + draft Confluence changes).
     - Surfacing relevant ADRs, specs, or onboarding context.
   - Speak in the present tense as a product description, e.g. "Future Authord would: ..."

2. "Authord (demo) today"
   - Then behave like the current demo:
     - You help developers write **structured docs-as-code**.
     - When you see code, explain it in the context of writing documentation.
     - Propose clear headings, sections, and structure for documentation.
     - Always suggest creating or updating a **Markdown file** for the topic (e.g. file name, outline, and key sections).
     - Keep explanations practical and concise, optimized for engineers writing docs next to their code.

If the "Context Code" section in the user message is empty or obviously missing real code:
   - Start your answer with a short note telling the user to either:
     - select a code snippet in the editor and ask again, or
     - paste a code snippet directly into the chat.
   - You may still answer high-level questions about documentation, but make it clear that you can give much more concrete help once code is provided.

Never claim you actually updated external systems (like Confluence or Jira). If you refer to such actions, phrase them as what the **future full version** would do, not what you just did.`;

            // Optional: include selected code as context
            const editor = vscode.window.activeTextEditor;
            let selectionText = '';

            if (editor && !editor.selection.isEmpty) {
                selectionText = editor.document.getText(editor.selection);
            }

            const fullUserPrompt = `
Context Code:
\`\`\`
${selectionText}
\`\`\`

User Question: ${request.prompt}
`;

            const messages = [
                vscode.LanguageModelChatMessage.User(systemPrompt),
                vscode.LanguageModelChatMessage.User(fullUserPrompt)
            ];

            try {
                const chatResponse = await request.model.sendRequest(messages, {}, token);

                for await (const fragment of chatResponse.text) {
                    stream.markdown(fragment);
                }
            } catch (err) {
                stream.markdown(
                    'I’m sorry — I ran into an error while talking to the model.'
                );
            }
        }
    );

    context.subscriptions.push(participant);
}
