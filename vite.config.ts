import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  // مهم لـ GitHub Pages: ضع المسار الفرعي لاسم الريبو
  base: '/rak-mrs-auth/',
  plugins: [react()],
})
