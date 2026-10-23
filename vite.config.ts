import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { messages } from "./src/messages";
const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "localized-document",
      transformIndexHtml(html) {
        return html
          .replace("__APP_LOCALE__", escapeHtml(messages.locale))
          .replace("__APP_TITLE__", escapeHtml(messages.app.title))
          .replace("__APP_DESCRIPTION__", escapeHtml(messages.app.description));
      },
    },
  ],
  // ローカルでAPIを別プロセスとして動かす場合の転送先。通常は `vercel dev` を使う。
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL ?? "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
  base: "./",
});
