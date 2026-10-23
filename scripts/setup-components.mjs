import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(repo, 'components/manifest.json')));
const root = resolve(process.env.LUUNA_AI_COMPONENTS_ROOT || join(repo, '.tools'));
const native = process.platform === 'win32' ? 'bun.exe' : 'bun';
const bun = [process.env.LUUNA_AI_BUN, ...(process.env.PATH || '').split(delimiter).map(p => join(p, native)), process.env.APPDATA && join(process.env.APPDATA, 'npm/node_modules/bun/bin/bun.exe')].find(p => p && existsSync(p));
function run(exe, args, cwd = repo) {
 const r = spawnSync(exe, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
 if (r.error || r.status !== 0) throw new Error(`${exe === bun ? 'Bun' : exe} ${args[0]} failed. Check tool installation, network access and checkout identity.`);
 return r.stdout.trim();
}
try {
 if (!bun || run(bun, ['--version']) !== manifest.runtime.version) throw new Error('Install native Bun 1.4.3 or set LUUNA_AI_BUN to that executable.');
 mkdirSync(join(root, 'components'), { recursive: true });
 for (const pin of manifest.components) {
  const path = join(root, pin.path);
  if (!existsSync(path)) {
   run('git', ['clone', '--no-checkout', pin.repository, path]);
   run('git', ['checkout', '--detach', pin.commit], path);
  }
  if (run('git', ['rev-parse', 'HEAD'], path) !== pin.commit || run('git', ['remote', 'get-url', 'origin'], path) !== pin.repository || run('git', ['status', '--porcelain', '--untracked-files=all'], path)) throw new Error(`${pin.brand}: wrong commit/origin or dirty checkout. Preserve it and select a clean install root.`);
  const pkg = JSON.parse(readFileSync(join(path, 'package.json')));
  if (pkg.name !== pin.package || pkg.version !== pin.sourceVersion || pkg.bin[pin.cli.primary] !== pin.cli.entrypoint) throw new Error(`${pin.brand}: package identity mismatch.`);
  run(bun, ['install', '--frozen-lockfile', '--ignore-scripts'], path);
  console.log(`${pin.brand}: verified ${pin.sourceVersion} at ${pin.commit}`);
 }
 console.log('Pinned components ready. Open Tools → Kanban / Prompt library / Expertise memory, then initialize the separate private project workspace.');
} catch (e) { console.error(e.message); process.exitCode = 1; }
