// Writes a Brotli (.br) and a gzip (.gz) copy next to each text file of a
// build, so the web server sends them as they are instead of compressing on
// every request (Caddy: `file_server { precompressed br gzip }`).
//   node scripts/precompress.mjs dist

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const TEXT = /\.(html|js|css|json|svg|txt|map)$/;
/** Not worth it below this: the headers cost more than they save. */
const MIN_BYTES = 1024;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

const root = process.argv[2];
if (!root) throw new Error("Usage: node scripts/precompress.mjs <build folder>");
let count = 0;
for (const path of files(root)) {
  if (!TEXT.test(path)) continue;
  const data = readFileSync(path);
  if (data.length < MIN_BYTES) continue;
  writeFileSync(`${path}.br`, brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
  writeFileSync(`${path}.gz`, gzipSync(data, { level: 9 }));
  count++;
}
console.log(`Compressed ${count} files in ${root}.`);
