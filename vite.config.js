import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";


export default defineConfig({
  base: "./",
  plugins: [basicSsl()],
  server: { host: true },
  // three.js is most of the bundle, and the AR page needs all of it up front, so
  // splitting it would add requests without loading anything later
  build: { chunkSizeWarningLimit: 800 },
});
