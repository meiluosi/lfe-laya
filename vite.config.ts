import { defineConfig } from 'vite';

export default defineConfig({
  build: { rollupOptions: { input: { prototype: 'index.html', lab: 'lab.html', studio: 'studio.html' } } },
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:8767', rewrite: path => path.replace(/^\/api/, '') } },
    watch: {
      // 模型、Python 环境和原始实验日志不参与前端热更新。
      ignored: ['**/.models/**', '**/.venv/**', '**/.tools/**', '**/experiments/**'],
    },
  },
  preview: { proxy: { '/api': { target: 'http://127.0.0.1:8767', rewrite: path => path.replace(/^\/api/, '') } } },
});
