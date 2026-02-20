export interface FileEntry {
  path: string;
  content: string;
}

export interface GenerationState {
  status: "idle" | "creating" | "generating" | "installing" | "ready";
  statusMessage: string;
  files: FileEntry[];
  activeFile: string | null;
  previewUrl: string | null;
  sandboxId: string | null;
  error: string | null;
}

export type SSEEvent =
  | { type: "status"; message: string }
  | { type: "sandbox"; sandboxId: string; previewUrl: string }
  | { type: "file"; path: string; content: string }
  | { type: "chunk"; text: string }
  | { type: "log"; message: string }
  | { type: "ready"; previewUrl: string }
  | { type: "done" }
  | { type: "error"; message: string };
