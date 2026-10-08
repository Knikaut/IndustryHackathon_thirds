import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// адрес бэкенда для режима разработки можно задать переменной TWIN_API
const api = process.env.TWIN_API ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": api } },
});
