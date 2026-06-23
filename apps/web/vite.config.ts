import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const webEnv = loadEnv(mode, process.cwd(), "");
  const apiEnv = loadEnv(mode, resolve(process.cwd(), "../api"), "");
  const apiUrl = webEnv.VITE_API_URL || apiEnv.VITE_API_URL || "http://localhost:4000";

  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_API_URL": JSON.stringify(apiUrl),
    },
    server: {
      port: 5173,
      strictPort: true,
    },
  };
});
