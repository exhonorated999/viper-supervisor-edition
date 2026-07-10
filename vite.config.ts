import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative base so the built bundle also loads over file:// in the Electron shell.
  base: "./",
  plugins: [react()],
  server: {
    port: Number(process.env.APP_PORT) || 5173,
    host: true,
  },
});
