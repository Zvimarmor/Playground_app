import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // onnxruntime-web is a large prebuilt bundle; its .wasm files are imported
  // by URL in src/lib/faces.js, so it needs no dev-time pre-bundling.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
})
