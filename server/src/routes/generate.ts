import type { Request, Response } from "express";
import { generateCode } from "../services/claude.js";
import {
  createSandbox,
  getSandbox,
  writeFile,
  startDevServer,
  getPreviewUrl,
} from "../services/sandbox.js";

function sendSSE(res: Response, data: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function generateRoute(req: Request, res: Response) {
  const { prompt, sandboxId } = req.body as {
    prompt: string;
    sandboxId?: string;
  };

  if (!prompt) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  // Set SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  try {
    // Step 1: Create or reuse sandbox
    sendSSE(res, { type: "status", message: "Creating sandbox..." });

    let sandbox;
    if (sandboxId) {
      sandbox = getSandbox(sandboxId);
    }
    if (!sandbox) {
      sandbox = await createSandbox();
    }

    const previewUrl = getPreviewUrl(sandbox);
    sendSSE(res, {
      type: "sandbox",
      sandboxId: sandbox.sandboxId,
      previewUrl,
    });

    // Step 2: Stream code generation from Claude
    sendSSE(res, { type: "status", message: "Generating code..." });

    const collectedFiles: Array<{ path: string; content: string }> = [];

    for await (const event of generateCode(prompt)) {
      if (event.type === "chunk") {
        // Send raw chunks for live code display
        sendSSE(res, { type: "chunk", text: event.text });
      } else if (event.type === "file") {
        collectedFiles.push({ path: event.path, content: event.content });
        sendSSE(res, {
          type: "file",
          path: event.path,
          content: event.content,
        });
      }
    }

    // Step 3: Write all files to sandbox
    sendSSE(res, { type: "status", message: "Writing files to sandbox..." });

    for (const file of collectedFiles) {
      try {
        await writeFile(sandbox, file.path, file.content);
        sendSSE(res, { type: "log", message: `Wrote ${file.path}` });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Failed to write ${file.path}:`, msg);
        sendSSE(res, { type: "log", message: `Failed to write ${file.path}: ${msg}` });
        throw err;
      }
    }

    // Step 4: Install dependencies and start dev server
    sendSSE(res, {
      type: "status",
      message: "Installing dependencies & starting dev server...",
    });

    await startDevServer(sandbox, (log) => {
      sendSSE(res, { type: "log", message: log });
    });

    // Step 5: Signal readiness
    sendSSE(res, { type: "ready", previewUrl });
    sendSSE(res, { type: "done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    sendSSE(res, { type: "error", message });
  } finally {
    res.end();
  }
}
