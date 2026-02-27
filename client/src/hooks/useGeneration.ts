import { useState, useCallback, useRef } from "react";
import type { GenerationState, SSEEvent, DeploySSEEvent } from "../types";

const initialState: GenerationState = {
  status: "idle",
  statusMessage: "",
  files: [],
  activeFile: null,
  previewUrl: null,
  sandboxId: null,
  error: null,
  deployStatus: "idle",
  deployStatusMessage: "",
  deployUrl: null,
  deployError: null,
};

export function useGeneration() {
  const [state, setState] = useState<GenerationState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(async (prompt: string) => {
    // Abort any existing generation
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({
      ...prev,
      status: "creating",
      statusMessage: "Starting...",
      error: null,
      files: prev.sandboxId ? prev.files : [], // Keep files if reusing sandbox
    }));

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          sandboxId: state.sandboxId,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Server error: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const event: SSEEvent = JSON.parse(jsonStr);
            handleEvent(event, setState);
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState((prev) => ({
        ...prev,
        status: "idle",
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    }
  }, [state.sandboxId]);

  const deploy = useCallback(async () => {
    if (!state.sandboxId) return;

    setState((prev) => ({
      ...prev,
      deployStatus: "deploying",
      deployStatusMessage: "Starting deploy...",
      deployError: null,
      deployUrl: null,
    }));

    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId: state.sandboxId }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Server error: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const event: DeploySSEEvent = JSON.parse(jsonStr);
            handleDeployEvent(event, setState);
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (err) {
      setState((prev) => ({
        ...prev,
        deployStatus: "error",
        deployError: err instanceof Error ? err.message : "Unknown error",
      }));
    }
  }, [state.sandboxId]);

  return { state, generate, deploy };
}

function handleEvent(
  event: SSEEvent,
  setState: React.Dispatch<React.SetStateAction<GenerationState>>
) {
  switch (event.type) {
    case "status":
      setState((prev) => ({
        ...prev,
        status: event.message.includes("Installing")
          ? "installing"
          : event.message.includes("Generating")
            ? "generating"
            : prev.status,
        statusMessage: event.message,
      }));
      break;

    case "sandbox":
      setState((prev) => ({
        ...prev,
        sandboxId: event.sandboxId,
        previewUrl: event.previewUrl,
      }));
      break;

    case "file":
      setState((prev) => {
        const existingIdx = prev.files.findIndex(
          (f) => f.path === event.path
        );
        const files =
          existingIdx >= 0
            ? prev.files.map((f, i) =>
                i === existingIdx ? { path: event.path, content: event.content } : f
              )
            : [...prev.files, { path: event.path, content: event.content }];

        return {
          ...prev,
          status: "generating",
          files,
          activeFile: prev.activeFile ?? event.path,
        };
      });
      break;

    case "ready":
      setState((prev) => ({
        ...prev,
        status: "ready",
        statusMessage: "App is running!",
        previewUrl: event.previewUrl,
      }));
      break;

    case "done":
      setState((prev) => ({
        ...prev,
        status: "ready",
        statusMessage: "Done",
      }));
      break;

    case "error":
      setState((prev) => ({
        ...prev,
        status: "idle",
        error: event.message,
      }));
      break;
  }
}

function handleDeployEvent(
  event: DeploySSEEvent,
  setState: React.Dispatch<React.SetStateAction<GenerationState>>
) {
  switch (event.type) {
    case "status":
      setState((prev) => ({
        ...prev,
        deployStatusMessage: event.message,
      }));
      break;

    case "deployed":
      setState((prev) => ({
        ...prev,
        deployStatus: "deployed",
        deployStatusMessage: "Deployed!",
        deployUrl: event.url,
      }));
      break;

    case "done":
      setState((prev) => ({
        ...prev,
        deployStatus: "deployed",
      }));
      break;

    case "error":
      setState((prev) => ({
        ...prev,
        deployStatus: "error",
        deployError: event.message,
      }));
      break;
  }
}
