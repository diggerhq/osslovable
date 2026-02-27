import type { Request, Response } from "express";
import {
  getSandbox,
  createSandbox,
  copyFiles,
  startDevServer,
  createDeployPreviewURL,
  APP_DIR,
} from "../services/sandbox.js";

function sendSSE(res: Response, data: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function deployRoute(req: Request, res: Response) {
  const { sandboxId } = req.body as { sandboxId?: string };

  if (!sandboxId) {
    res.status(400).json({ error: "sandboxId is required" });
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
    // Step 1: Look up dev sandbox
    console.log(`[deploy] [${elapsed()}] Step 1: Looking up dev sandbox ${sandboxId}...`);
    sendSSE(res, { type: "status", message: "Looking up dev sandbox..." });

    const devSandbox = getSandbox(sandboxId);
    if (!devSandbox) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }

    // Step 2: Create fresh deploy sandbox
    console.log(`[deploy] [${elapsed()}] Step 2: Creating deploy sandbox...`);
    sendSSE(res, { type: "status", message: "Creating deploy sandbox..." });

    const deploySandbox = await createSandbox();
    console.log(`[deploy] [${elapsed()}] Created deploy sandbox ${deploySandbox.sandboxId}`);

    // Step 3: Copy files
    console.log(`[deploy] [${elapsed()}] Step 3: Copying files...`);
    sendSSE(res, { type: "status", message: "Copying files to deploy sandbox..." });

    await copyFiles(devSandbox, deploySandbox, APP_DIR, (log) => {
      console.log(`[deploy] [${elapsed()}] ${log}`);
      sendSSE(res, { type: "log", message: log });
    });

    // Step 4: Start server
    console.log(`[deploy] [${elapsed()}] Step 4: Starting server...`);
    sendSSE(res, { type: "status", message: "Installing dependencies & starting server..." });

    await startDevServer(deploySandbox, (log) => {
      console.log(`[deploy] [${elapsed()}] [devserver] ${log}`);
      sendSSE(res, { type: "log", message: log });
    });

    // Step 5: Create deploy URL
    console.log(`[deploy] [${elapsed()}] Step 5: Creating deploy URL...`);
    sendSSE(res, { type: "status", message: "Creating deploy URL..." });

    const url = await createDeployPreviewURL(deploySandbox);
    console.log(`[deploy] [${elapsed()}] Deploy URL: ${url}`);

    sendSSE(res, { type: "deployed", url });
    sendSSE(res, { type: "done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[deploy] [${elapsed()}] ERROR: ${message}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    sendSSE(res, { type: "error", message });
  } finally {
    console.log(`[deploy] [${elapsed()}] Total time.`);
    res.end();
  }
}
