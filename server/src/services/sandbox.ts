import { Sandbox } from "opensandbox";

export const APP_DIR = "/root/app";

// Cache of active sandboxes by ID
const activeSandboxes = new Map<string, Sandbox>();

export async function createSandbox(): Promise<Sandbox> {
  const sandbox = await Sandbox.create({
    template: "node",
    timeout: 600,
    apiKey: process.env.OPENSANDBOX_API_KEY,
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
    await sandbox.commands.run(`mkdir -p ${dir}`);
  }

  // Write file using base64 to safely handle all content
  const b64 = Buffer.from(content).toString("base64");
  const result = await sandbox.commands.run(
    `echo '${b64}' | base64 -d > ${path}`
  );

  if (result.exitCode !== 0) {
    throw new Error(`Failed to write ${path}: ${result.stderr}`);
  }
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
    allowedHosts: true,
    hmr: false,
  },
});
`;
  const b64Vite = Buffer.from(viteConfig.trim()).toString("base64");
  await sandbox.commands.run(
    `echo '${b64Vite}' | base64 -d > ${APP_DIR}/vite.config.ts`
  );
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
  const b64Ts = Buffer.from(tsconfig.trim()).toString("base64");
  const b64TsNode = Buffer.from(tsconfigNode.trim()).toString("base64");
  await sandbox.commands.run(
    `echo '${b64Ts}' | base64 -d > ${APP_DIR}/tsconfig.json && echo '${b64TsNode}' | base64 -d > ${APP_DIR}/tsconfig.node.json`
  );
  onLog?.("Patched tsconfig files");

  // Install dependencies (node template already has node/npm)
  onLog?.("Running npm install...");
  let result = await sandbox.commands.run(`cd ${APP_DIR} && npm install`, {
    timeout: 120,
  });
  onLog?.(`npm install done (exit ${result.exitCode})`);
  if (result.exitCode !== 0) {
    onLog?.(`npm stderr: ${result.stderr}`);
  }

  // Force correct versions of vite + tailwind (Claude often generates incompatible versions)
  result = await sandbox.commands.run(
    `cd ${APP_DIR} && npm install vite@latest @vitejs/plugin-react@latest tailwindcss@latest @tailwindcss/vite@latest 2>&1 | tail -3`,
    { timeout: 60 }
  );
  onLog?.(`Core deps ensured (exit ${result.exitCode}): ${result.stdout.trim()}`);

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

  // Poll until vite is listening (up to 15s)
  for (let i = 0; i < 15; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const check = await sandbox.commands.run(
      `grep -q "Local:" /tmp/vite.log 2>/dev/null && echo READY || echo WAITING`
    );
    if (check.stdout.trim() === "READY") {
      onLog?.("Vite is ready!");
      return;
    }
  }

  // Log whatever vite output for debugging
  result = await sandbox.commands.run("cat /tmp/vite.log");
  onLog?.(`Vite log: ${result.stdout}`);
}

export function getPreviewUrl(sandbox: Sandbox): string {
  return `https://${sandbox.domain}`;
}
