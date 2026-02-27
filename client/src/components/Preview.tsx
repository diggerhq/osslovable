import { useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";

interface Props {
  url: string | null;
  isLoading: boolean;
}

export default function Preview({ url, isLoading }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex flex-col h-full">
      {/* Preview toolbar */}
      <div className="h-10 flex items-center gap-2 px-3 border-b border-border shrink-0">
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={!url}
          className="p-1.5 rounded-md hover:bg-surface-lighter text-[#8888a0] hover:text-white transition-colors disabled:opacity-30"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <div className="flex-1 flex items-center bg-surface-light rounded-lg px-3 py-1 text-xs text-[#8888a0] truncate border border-border/50">
          Preview
        </div>
      </div>

      {/* iframe or loading state */}
      <div className="flex-1 relative bg-white">
        {url && !isLoading ? (
          <iframe
            key={refreshKey}
            src={url}
            className="w-full h-full border-0"
            title="App preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface-light">
            <Loader2 className="w-8 h-8 animate-spin text-brand-500 mb-3" />
            <p className="text-sm text-[#8888a0]">
              {isLoading
                ? "Building your app..."
                : "Enter a prompt to get started"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
