import { Sandbox } from "@opencomputer/sdk";
import type { EntryInfo } from "@opencomputer/sdk";

export const APP_DIR = "/workspace";

// Cache of active sandboxes by ID
const activeSandboxes = new Map<string, Sandbox>();

export async function createSandbox(): Promise<Sandbox> {
  const sandbox = await Sandbox.create({
    template: "node",
    timeout: 600,
    apiKey: process.env.OPENCOMPUTER_API_KEY,
    memoryMB: 1024,
    cpuCount: 2,
  });

  activeSandboxes.set(sandbox.sandboxId, sandbox);

  // Create the app directory
  await sandbox.commands.run(`mkdir -p ${APP_DIR}`);

  return sandbox;
}

export function getSandbox(sandboxId: string): Sandbox | undefined {
  return activeSandboxes.get(sandboxId);
}

export async function writeFile(
  sandbox: Sandbox,
  path: string,
  content: string
): Promise<void> {
  // Ensure parent directory exists
  const dir = path.substring(0, path.lastIndexOf("/"));
  if (dir) {
    await sandbox.files.makeDir(dir);
  }

  await sandbox.files.write(path, content);
}

export async function startDevServer(
  sandbox: Sandbox,
  onLog?: (msg: string) => void
): Promise<void> {
  // Overwrite vite.config.ts to guarantee correct server settings
  // HMR uses WebSocket — configure clientPort 443 so the browser connects over wss:// to the sandbox domain
  const viteConfig = `
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 80,
    strictPort: true,
    allowedHosts: true,
    hmr: false,
  },
});
`;
  await sandbox.files.write(`${APP_DIR}/vite.config.ts`, viteConfig.trim());
  onLog?.("Patched vite.config.ts with correct server settings");

  // Ensure tsconfig files exist (Vite 7 requires tsconfig.node.json)
  const tsconfig = `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}`;
  const tsconfigNode = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["vite.config.ts"]
}`;
  await sandbox.files.write(`${APP_DIR}/tsconfig.json`, tsconfig.trim());
  await sandbox.files.write(`${APP_DIR}/tsconfig.node.json`, tsconfigNode.trim());
  onLog?.("Patched tsconfig files");

  // Log sandbox environment for debugging
  const envInfo = await sandbox.commands.run(`whoami && pwd && ls -la ${APP_DIR}/ 2>&1 | head -20`);
  onLog?.(`Sandbox env: ${envInfo.stdout.trim()}`);
  const nodeInfo = await sandbox.commands.run(`node -v && npm -v`);
  onLog?.(`Node: ${nodeInfo.stdout.trim().replace(/\n/g, ", npm: ")}`);

  // Fix version conflicts before npm install — Claude often generates outdated
  // vite/tailwind versions that conflict with each other.
  onLog?.("Pinning core dependency versions...");
  await sandbox.commands.run(
    `cd ${APP_DIR} && node -e "
      const pkg = JSON.parse(require('fs').readFileSync('package.json','utf8'));
      const pins = {
        'vite': '^6.0.0',
        '@vitejs/plugin-react': '^4.0.0',
        'tailwindcss': '^4.0.0',
        '@tailwindcss/vite': '^4.0.0',
      };
      for (const [name, ver] of Object.entries(pins)) {
        if (pkg.dependencies?.[name]) pkg.dependencies[name] = ver;
        if (pkg.devDependencies?.[name]) pkg.devDependencies[name] = ver;
      }
      require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2));
    "`
  );

  // Install dependencies
  onLog?.("Running npm install...");
  let result = await sandbox.commands.run(`cd ${APP_DIR} && npm install --cache /workspace/.npm-cache`, {
    timeout: 300,
  });
  onLog?.(`npm install done (exit ${result.exitCode})`);

  // Retry with --legacy-peer-deps if there are peer conflicts
  if (result.exitCode !== 0) {
    onLog?.("npm install failed, retrying with --legacy-peer-deps...");
    result = await sandbox.commands.run(`cd ${APP_DIR} && npm install --cache /workspace/.npm-cache --legacy-peer-deps`, {
      timeout: 300,
    });
    onLog?.(`npm install --legacy-peer-deps done (exit ${result.exitCode})`);
  }

  if (result.exitCode !== 0) {
    onLog?.(`npm stderr: ${result.stderr}`);
    throw new Error(`npm install failed (exit ${result.exitCode}): ${result.stderr}`);
  }

  // Ensure compatible core deps (sandbox has ~500MB RAM and Node 20.18 — Vite 7 requires Node 20.19+ and OOMs)
  result = await sandbox.commands.run(
    `cd ${APP_DIR} && npm install --cache /workspace/.npm-cache vite@^6.0.0 @vitejs/plugin-react@^4.0.0 tailwindcss@^4.0.0 @tailwindcss/vite@^4.0.0 2>&1 | tail -3`,
    { timeout: 300 }
  );
  onLog?.(`Core deps ensured (exit ${result.exitCode}): ${result.stdout.trim()}`);

  // Log installed packages
  const pkgInfo = await sandbox.commands.run(`cd ${APP_DIR} && ls node_modules/.bin/vite 2>&1 && du -sh node_modules 2>&1`);
  onLog?.(`node_modules check: ${pkgInfo.stdout.trim()}`);

  // Verify vite binary exists
  const viteCheck = await sandbox.commands.run(`ls ${APP_DIR}/node_modules/.bin/vite`);
  if (viteCheck.exitCode !== 0) {
    throw new Error("Vite binary not found after npm install — node_modules may be incomplete");
  }

  // Ensure index.css has the correct Tailwind v4 import
  await sandbox.commands.run(
    `cd ${APP_DIR} && if ! grep -q '@import "tailwindcss"' src/index.css 2>/dev/null; then echo '@import "tailwindcss";' | cat - src/index.css > /tmp/css.tmp && mv /tmp/css.tmp src/index.css; fi`
  );

  // Start dev server in background
  onLog?.("Starting dev server...");
  await sandbox.commands.run(
    `cd ${APP_DIR} && nohup npm run dev -- --host 0.0.0.0 --port 80 > /tmp/vite.log 2>&1 &`,
    { timeout: 10 }
  );
  onLog?.("Dev server started, waiting for it to be ready...");

  // Poll until vite is listening (up to 30s)
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const check = await sandbox.commands.run(
      `grep -q "Local:" /tmp/vite.log 2>/dev/null && echo READY || echo WAITING`
    );
    if (check.stdout.trim() === "READY") {
      // Verify Vite is actually serving HTTP responses (it may have printed "Local:" then crashed)
      const health = await sandbox.commands.run(
        `curl -s -o /dev/null -w '%{http_code}' http://localhost:80 2>&1`
      );
      const status = health.stdout.trim();
      if (status === "200" || status === "304") {
        onLog?.("Vite is ready and responding on port 80!");
        return;
      }
      // Vite log showed "Local:" but HTTP isn't responding — check if process is still alive
      onLog?.(`Vite log shows ready but HTTP returned ${status}, checking process...`);
      const alive = await sandbox.commands.run(`pgrep -f "vite" > /dev/null 2>&1 && echo ALIVE || echo DEAD`);
      if (alive.stdout.trim() === "DEAD") {
        const log = await sandbox.commands.run("cat /tmp/vite.log 2>/dev/null");
        throw new Error(`Vite printed "Local:" but process died. Log:\n${log.stdout}`);
      }
      // Process alive but not responding yet — keep polling
      onLog?.("Vite process alive but not responding yet, continuing to poll...");
    }
    // Log progress every 5 seconds
    if (i > 0 && i % 5 === 0) {
      const partialLog = await sandbox.commands.run(`tail -5 /tmp/vite.log 2>/dev/null`);
      onLog?.(`Vite log (${i}s): ${partialLog.stdout.trim()}`);
    }
    // Early exit if the vite process has already exited with an error
    const proc = await sandbox.commands.run(`pgrep -f "vite" > /dev/null 2>&1 && echo ALIVE || echo DEAD`);
    if (proc.stdout.trim() === "DEAD") {
      const log = await sandbox.commands.run("cat /tmp/vite.log 2>/dev/null");
      throw new Error(`Vite process exited prematurely. Log:\n${log.stdout}`);
    }
  }

  // Timed out — dump logs and throw
  result = await sandbox.commands.run("cat /tmp/vite.log 2>/dev/null");
  onLog?.(`Vite log: ${result.stdout}`);
  // Also check what's actually listening
  const ports = await sandbox.commands.run("ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo 'no port info'");
  onLog?.(`Listening ports: ${ports.stdout}`);
  throw new Error(`Dev server did not become ready within 30s. Vite log:\n${result.stdout}`);
}

export async function createPreviewUrl(sandbox: Sandbox): Promise<string> {
  const existing = await sandbox.listPreviewURLs();
  const match = existing.find((p) => p.port === 80);
  if (match) {
    return `https://${match.hostname}`;
  }
  const result = await sandbox.createPreviewURL({ port: 80 });
  return `https://${result.hostname}`;
}

/**
 * Recursively copy files from one sandbox to another.
 * Skips node_modules and .npm-cache directories.
 */
export async function copyFiles(
  source: Sandbox,
  target: Sandbox,
  basePath: string,
  onLog?: (msg: string) => void
): Promise<void> {
  const entries: EntryInfo[] = await source.files.list(basePath);
  for (const entry of entries) {
    if (entry.isDir) {
      if (entry.name === "node_modules" || entry.name === ".npm-cache") continue;
      await target.files.makeDir(entry.path);
      await copyFiles(source, target, entry.path, onLog);
    } else {
      const bytes = await source.files.readBytes(entry.path);
      await target.files.write(entry.path, bytes);
      onLog?.(`Copied ${entry.path}`);
    }
  }
}

/**
 * Create a deploy preview URL for public access.
 */
export async function createDeployPreviewURL(
  sandbox: Sandbox
): Promise<string> {
  const domain = process.env.DEPLOY_DOMAIN || "openlovable.cc";
  const result = await sandbox.createPreviewURL({ port: 80, domain, authConfig: {} });
  return `https://${result.customHostname || result.hostname}`;
}
