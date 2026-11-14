// Upload the speaker cut-out model (MODNet portrait matting, Apache-2.0, ONNX export from Hugging Face Xenova/modnet)
// to private Blob, where the part workers download it on first use (lib/unedit-cutout.ts).
//   node --env-file=<env file with BLOB_READ_WRITE_TOKEN> scripts/upload-cutout-model.mjs <path to model.onnx>
import fs from 'node:fs';
import { put } from '@vercel/blob';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/upload-cutout-model.mjs <model.onnx>');
const r = await put('models/modnet-photographic-portrait-matting.onnx', fs.readFileSync(file), { access: 'private', contentType: 'application/octet-stream', addRandomSuffix: false, allowOverwrite: true, multipart: true });
console.log('uploaded', r.pathname, fs.statSync(file).size, 'bytes');
// And onnxruntime-web's WebAssembly runtime (the version package.json pins), which the function's file tracing drops.
for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  const src = `node_modules/onnxruntime-web/dist/${f}`;
  const u = await put(`models/onnxruntime-web-1.22.0/${f}`, fs.readFileSync(src), { access: 'private', contentType: f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', addRandomSuffix: false, allowOverwrite: true, multipart: true });
  console.log('uploaded', u.pathname, fs.statSync(src).size, 'bytes');
}
