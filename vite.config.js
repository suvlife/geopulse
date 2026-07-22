import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  server: { port: 5188 },
  resolve: {
    alias: {
      // satellite.js 的 wasm 构建(含 top-level await/Node API)会破坏浏览器打包,
      // 强制使用纯 JS 实现:屏蔽 wasm worker 动态导入
      '#wasm-single-thread': path.resolve(__dirname, 'src/utils/satellite-wasm-stub.js'),
      '#wasm-multi-thread': path.resolve(__dirname, 'src/utils/satellite-wasm-stub.js'),
    },
  },
  optimizeDeps: {
    exclude: ['satellite.js'],
  },
  build: {
    commonjsOptions: {
      // 卫星模块内部包含动态 wasm worker 分支,忽略即可
      ignore: ['node:*', 'node:module', 'node:worker_threads'],
    },
  },
})
