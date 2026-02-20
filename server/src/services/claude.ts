import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

const SYSTEM_PROMPT = `You are an expert React developer. The user will describe an app they want to build. You must generate a complete Vite + React + TypeScript project.

Output every file using this exact XML format — one block per file:

<file path="/root/app/package.json">
file contents here
</file>

Rules:
1. Always include these files at minimum:
   - /root/app/package.json (with "vite", "react", "react-dom", "@vitejs/plugin-react", "typescript", "@types/react", "@types/react-dom", "tailwindcss", "@tailwindcss/vite" as dependencies/devDependencies)
   - /root/app/index.html (with a root div and script tag pointing to /src/main.tsx)
   - /root/app/vite.config.ts (with react plugin, tailwindcss plugin, server.host set to "0.0.0.0", server.port set to 80, and server.allowedHosts set to true)
   - /root/app/tsconfig.json
   - /root/app/src/main.tsx (renders App into root)
   - /root/app/src/App.tsx (main application component)
   - /root/app/src/index.css (import tailwindcss)
2. Use Tailwind CSS v4 for all styling (imported via \`@import "tailwindcss";\` in index.css)
3. Keep everything self-contained — do not make external API calls unless the user specifically asks for it
4. Write clean, well-structured TypeScript/React code
5. Do NOT include any explanation outside of the file blocks — only output <file> blocks
6. Make sure the app is visually polished and functional`;

export interface ParsedFile {
  path: string;
  content: string;
}

export async function* generateCode(
  prompt: string
): AsyncGenerator<
  | { type: "chunk"; text: string }
  | { type: "file"; path: string; content: string }
> {
  const stream = getClient().messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  let buffer = "";

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      const text = event.delta.text;
      buffer += text;

      yield { type: "chunk", text };

      // Try to extract complete files from buffer
      const fileRegex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g;
      let match: RegExpExecArray | null;

      while ((match = fileRegex.exec(buffer)) !== null) {
        const filePath = match[1];
        const content = match[2].trim();
        yield { type: "file", path: filePath, content };

        // Remove the matched file block from buffer
        buffer = buffer.slice(0, match.index) + buffer.slice(match.index + match[0].length);
        fileRegex.lastIndex = 0; // Reset since we modified buffer
      }
    }
  }

  // Final pass: extract any remaining files from buffer
  const fileRegex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g;
  let match: RegExpExecArray | null;
  while ((match = fileRegex.exec(buffer)) !== null) {
    yield {
      type: "file",
      path: match[1],
      content: match[2].trim(),
    };
  }
}
