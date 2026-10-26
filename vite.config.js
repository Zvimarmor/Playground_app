import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // onnxruntime-web finds its .wasm next to its own module via import.meta.url,
  // which dev-time pre-bundling would break.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
})
