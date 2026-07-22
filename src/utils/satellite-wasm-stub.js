// stub:禁用 satellite.js 的 wasm worker,强制使用纯 JS 实现
export default function createWasmModule() {
  return null
}
