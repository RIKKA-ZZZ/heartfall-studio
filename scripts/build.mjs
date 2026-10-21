import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const src=path.join(root,'src');
const [html,css,core,app]=await Promise.all(['index.html','styles.css','core.js','app.js'].map(file=>fs.readFile(path.join(src,file),'utf8')));
const result=html.replace('/* STYLES */',css).replace('/* CORE */',core).replace('/* APP */',app);
await fs.writeFile(path.join(root,'index.html'),result,'utf8');
console.log(`Built index.html (${Buffer.byteLength(result)} bytes).`);
