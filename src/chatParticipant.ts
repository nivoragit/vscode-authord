import * as vscode from 'vscode';

export function registerAuthordChatParticipant(context: vscode.ExtensionContext) {
    const participant = vscode.chat.createChatParticipant(
        'authord.chat', // 👈 must match package.json id
        async (request, chatContext, stream, token) => {
            stream.progress('Thinking about documentation...');

            const systemPrompt = `You are Authord, a documentation expert.
You help developers write structured docs-as-code.
When you see code, explain it in the context of writing documentation.
Always suggest creating a Markdown file for the topic.`;

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
