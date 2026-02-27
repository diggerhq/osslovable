import { useState } from "react";
import type { GenerationState } from "../types";
import FileTree from "./FileTree";
import CodeEditor from "./CodeEditor";
import Preview from "./Preview";
import PromptInput from "./PromptInput";
import { Loader2, Code2, Eye, Rocket, ExternalLink, Check } from "lucide-react";

interface Props {
  state: GenerationState;
  onGenerate: (prompt: string) => void;
  onDeploy: () => void;
}

export default function Workspace({ state, onGenerate, onDeploy }: Props) {
  const [activeFile, setActiveFile] = useState<string | null>(
    state.activeFile
  );
  // Mobile tab: "code" or "preview"
  const [mobileTab, setMobileTab] = useState<"code" | "preview">("code");

  const selectedFile = activeFile ?? state.activeFile;
  const fileContent =
    state.files.find((f) => f.path === selectedFile)?.content ?? "";

  const isGenerating =
    state.status === "creating" ||
    state.status === "generating" ||
    state.status === "installing";

  const isDeploying = state.deployStatus === "deploying";
  const isDeployed = state.deployStatus === "deployed";
  const canDeploy = state.status === "ready" && !isDeploying;

  return (
    <div className="h-screen flex flex-col bg-surface">
      {/* Top bar */}
      <header className="h-12 flex items-center justify-between px-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tracking-tight text-white">
            Lovable OSS
          </span>
          {state.statusMessage && (
            <div className="flex items-center gap-2 text-xs text-[#8888a0]">
              {isGenerating && (
                <Loader2 className="w-3 h-3 animate-spin text-brand-400" />
              )}
              <span>{state.statusMessage}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Deploy status message */}
          {isDeploying && state.deployStatusMessage && (
            <span className="hidden md:inline text-xs text-[#8888a0]">
              {state.deployStatusMessage}
            </span>
          )}

          {/* Deployed URL */}
          {isDeployed && state.deployUrl && (
            <a
              href={state.deployUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden md:flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
            >
              <Check className="w-3 h-3" />
              <span className="max-w-[200px] truncate">{state.deployUrl.replace("https://", "")}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}

          {/* Deploy button */}
          <button
            onClick={onDeploy}
            disabled={!canDeploy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isDeploying ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Rocket className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">{isDeployed ? "Redeploy" : "Deploy"}</span>
          </button>
        </div>

        {/* Mobile tab switcher */}
        <div className="flex md:hidden items-center gap-1 bg-surface-light rounded-lg p-0.5">
          <button
            onClick={() => setMobileTab("code")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              mobileTab === "code"
                ? "bg-surface-lighter text-white"
                : "text-[#8888a0]"
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            Code
          </button>
          <button
            onClick={() => setMobileTab("preview")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              mobileTab === "preview"
                ? "bg-surface-lighter text-white"
                : "text-[#8888a0]"
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            Preview
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: File tree + Code editor */}
        <div
          className={`${
            mobileTab === "code" ? "flex" : "hidden"
          } md:flex flex-col w-full md:w-[45%] md:min-w-[360px] border-r border-border`}
        >
          <FileTree
            files={state.files}
            activeFile={selectedFile}
            onSelect={setActiveFile}
          />
          <div className="flex-1 overflow-hidden">
            <CodeEditor
              content={fileContent}
              filePath={selectedFile}
              readOnly={isGenerating}
            />
          </div>
        </div>

        {/* Right panel: Preview */}
        <div
          className={`${
            mobileTab === "preview" ? "flex" : "hidden"
          } md:flex flex-col flex-1`}
        >
          <Preview
            url={state.previewUrl}
            isLoading={state.status !== "ready"}
          />
        </div>
      </div>

      {/* Bottom prompt input */}
      <PromptInput onSubmit={onGenerate} disabled={isGenerating} />

      {/* Error toast */}
      {state.error && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-red-600/90 text-white text-sm px-4 py-2 rounded-lg shadow-lg backdrop-blur">
          {state.error}
        </div>
      )}

      {/* Deploy error toast */}
      {state.deployError && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-red-600/90 text-white text-sm px-4 py-2 rounded-lg shadow-lg backdrop-blur">
          Deploy failed: {state.deployError}
        </div>
      )}
    </div>
  );
}
