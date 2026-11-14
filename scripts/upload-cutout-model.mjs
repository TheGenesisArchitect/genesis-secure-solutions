// Upload the speaker cut-out model (MODNet portrait matting, Apache-2.0, ONNX export from Hugging Face Xenova/modnet)
// to private Blob, where the part workers download it on first use (lib/unedit-cutout.ts).
//   node --env-file=<env file with BLOB_READ_WRITE_TOKEN> scripts/upload-cutout-model.mjs <path to model.onnx>
import fs from 'node:fs';
import { put } from '@vercel/blob';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/upload-cutout-model.mjs <model.onnx>');
const r = await put('models/modnet-photographic-portrait-matting.onnx', fs.readFileSync(file), { access: 'private', contentType: 'application/octet-stream', addRandomSuffix: false, allowOverwrite: true, multipart: true });
console.log('uploaded', r.pathname, fs.statSync(file).size, 'bytes');
