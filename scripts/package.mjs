import { mkdir, copyFile, readFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (pkg.version !== manifest.version) throw new Error('package.json 和 manifest.json 版本不一致');
await mkdir('dist/ai-box', { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  await copyFile(file, `dist/ai-box/${file}`);
}
console.log('安装文件已生成：dist/ai-box');
