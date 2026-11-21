import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import aiHandler from "./api/ai";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "claimlens-local-api",
      configureServer(server) {
        server.middlewares.use("/api/ai", (req, res) => {
          void aiHandler(req, res);
        });
      },
    },
  ],
  build: { chunkSizeWarningLimit: 700 },
});
