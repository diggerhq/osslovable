import type { Request, Response } from "express";
import { generateCode } from "../services/claude.js";
import {
  createSandbox,
  getSandbox,
  writeFile,
  startDevServer,
  createPreviewUrl,
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

  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  try {
    // Step 1: Create or reuse sandbox
    console.log(`[generate] [${elapsed()}] Step 1: Creating sandbox...`);
    sendSSE(res, { type: "status", message: "Creating sandbox..." });

    let sandbox;
    if (sandboxId) {
      sandbox = getSandbox(sandboxId);
      if (sandbox) console.log(`[generate] [${elapsed()}] Reusing sandbox ${sandboxId}`);
    }
    if (!sandbox) {
      sandbox = await createSandbox();
      console.log(`[generate] [${elapsed()}] Created sandbox ${sandbox.sandboxId}`);
    }

    const previewUrl = await createPreviewUrl(sandbox);
    console.log(`[generate] [${elapsed()}] Preview URL: ${previewUrl}`);
    sendSSE(res, {
      type: "sandbox",
      sandboxId: sandbox.sandboxId,
      previewUrl,
    });

    // Step 2: Stream code generation from Claude
    console.log(`[generate] [${elapsed()}] Step 2: Generating code...`);
    sendSSE(res, { type: "status", message: "Generating code..." });

    const collectedFiles: Array<{ path: string; content: string }> = [];

    for await (const event of generateCode(prompt)) {
      if (event.type === "chunk") {
        sendSSE(res, { type: "chunk", text: event.text });
      } else if (event.type === "file") {
        collectedFiles.push({ path: event.path, content: event.content });
        console.log(`[generate] [${elapsed()}] Parsed file: ${event.path} (${event.content.length} bytes)`);
        sendSSE(res, {
          type: "file",
          path: event.path,
          content: event.content,
        });
      }
    }

    console.log(`[generate] [${elapsed()}] Code generation done. ${collectedFiles.length} files.`);

    // Step 3: Write all files to sandbox
    console.log(`[generate] [${elapsed()}] Step 3: Writing files...`);
    sendSSE(res, { type: "status", message: "Writing files to sandbox..." });

    for (const file of collectedFiles) {
      try {
        await writeFile(sandbox, file.path, file.content);
        console.log(`[generate] [${elapsed()}] Wrote ${file.path}`);
        sendSSE(res, { type: "log", message: `Wrote ${file.path}` });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[generate] [${elapsed()}] FAILED to write ${file.path}:`, msg);
        sendSSE(res, { type: "log", message: `Failed to write ${file.path}: ${msg}` });
        throw err;
      }
    }

    // Step 4: Install dependencies and start dev server
    console.log(`[generate] [${elapsed()}] Step 4: Starting dev server...`);
    sendSSE(res, {
      type: "status",
      message: "Installing dependencies & starting dev server...",
    });

    await startDevServer(sandbox, (log) => {
      console.log(`[generate] [${elapsed()}] [devserver] ${log}`);
      sendSSE(res, { type: "log", message: log });
    });

    // Step 5: Signal readiness
    console.log(`[generate] [${elapsed()}] Step 5: Ready! Preview: ${previewUrl}`);
    sendSSE(res, { type: "ready", previewUrl });
    sendSSE(res, { type: "done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[generate] [${elapsed()}] ERROR: ${message}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    sendSSE(res, { type: "error", message });
  } finally {
    console.log(`[generate] [${elapsed()}] Total time.`);
    res.end();
  }
}
