import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Tauri expects a fixed port and does not want Vite to obscure Rust errors.
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte()],

  // Prevent Vite from clearing Rust errors from the terminal.
  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Tauri sources are watched by cargo, not Vite.
      ignored: ["**/src-tauri/**"],
    },
  },

  // Produce a small, modern bundle for the OS webview.
  build: {
    target: "esnext",
    minify: "esbuild",
    sourcemap: false,
  },
});
