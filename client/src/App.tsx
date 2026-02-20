import { useState } from "react";
import { useGeneration } from "./hooks/useGeneration";
import LandingPage from "./components/LandingPage";
import Workspace from "./components/Workspace";

type View = "landing" | "workspace";

export default function App() {
  const [view, setView] = useState<View>("landing");
  const { state, generate } = useGeneration();

  const handleGenerate = async (prompt: string) => {
    setView("workspace");
    await generate(prompt);
  };

  if (view === "workspace") {
    return <Workspace state={state} onGenerate={handleGenerate} />;
  }

  return <LandingPage onGenerate={handleGenerate} />;
}
