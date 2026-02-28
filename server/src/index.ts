import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") }); // no-op in production if .env missing
import express from "express";
import cors from "cors";
import { generateRoute } from "./routes/generate.js";
import { deployRoute } from "./routes/deploy.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.post("/api/generate", generateRoute);
app.post("/api/deploy", deployRoute);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// Serve client static files in production
const clientDist = path.resolve(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
