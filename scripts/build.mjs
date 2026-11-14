import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

const PURE_SIM_FILES = new Set([
  'src/core/engine.js',
  'src/core/config.js',
  'src/core/events.js',
  'src/core/i18n.js',
  'src/world/map.js'
]);

const FORBIDDEN_SIM_PATTERNS = [
  { name: 'window', regex: /\bwindow\b/ },
  { name: 'document', regex: /\bdocument\b/ },
  { name: 'localStorage', regex: /\blocalStorage\b/ },
  { name: 'sessionStorage', regex: /\bsessionStorage\b/ },
  { name: 'WebGL2RenderingContext', regex: /\bWebGL2RenderingContext\b/ },
  { name: 'three import', regex: /from\s+['"]three['"]/ }
];

const UNSAFE_DOM_PATTERNS = [
  { name: 'innerHTML', regex: /\.innerHTML\b/ },
  { name: 'outerHTML', regex: /\.outerHTML\b/ },
  { name: 'insertAdjacentHTML', regex: /\.insertAdjacentHTML\b/ },
  { name: 'document.write', regex: /\bdocument\.write\b/ }
];

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function collectFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function validateSources() {
  const jsFiles = collectFiles(srcDir).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
  for (const filePath of jsFiles) {
    execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' });
    const rel = path.relative(rootDir, filePath).split(path.sep).join('/');
    const raw = fs.readFileSync(filePath, 'utf8');
    const clean = stripComments(raw);

    if (PURE_SIM_FILES.has(rel) || rel.startsWith('src/gameplay/') || rel.startsWith('src/locales/')) {
      for (const rule of FORBIDDEN_SIM_PATTERNS) {
        if (rule.regex.test(clean)) {
          throw new Error(`[build] Architecture invariant violation in ${rel}: forbidden reference to ${rule.name}`);
        }
      }
      if (/from\s+['"][^'"]*render\//.test(clean) || /from\s+['"][^'"]*ui\//.test(clean)) {
        throw new Error(`[build] Architecture invariant violation in ${rel}: simulation module cannot import render/ or ui/`);
      }
    }

    for (const rule of UNSAFE_DOM_PATTERNS) {
      if (rule.regex.test(clean)) {
        throw new Error(`[build] Security policy violation in ${rel}: forbidden DOM API ${rule.name}`);
      }
    }
  }
  return jsFiles;
}

function buildDist() {
  const startMs = performance.now();
  const validatedJs = validateSources();

  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  const filesToCopy = [path.join(rootDir, 'index.html'), ...collectFiles(srcDir)];
  const assetsDir = path.join(rootDir, 'assets');
  if (fs.existsSync(assetsDir)) {
    filesToCopy.push(...collectFiles(assetsDir));
  }

  const manifest = {
    name: 'redalert3a',
    version: '2.2.0',
    builtAt: new Date().toISOString(),
    files: {}
  };

  let totalBytes = 0;
  for (const absSrc of filesToCopy) {
    const rel = path.relative(rootDir, absSrc).split(path.sep).join('/');
    const absDst = path.join(distDir, rel);
    fs.mkdirSync(path.dirname(absDst), { recursive: true });
    const buf = fs.readFileSync(absSrc);
    fs.writeFileSync(absDst, buf);
    totalBytes += buf.length;
    manifest.files[rel] = {
      bytes: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex')
    };
  }

  fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const elapsedMs = (performance.now() - startMs).toFixed(1);
  console.log(`[build] OK: validated ${validatedJs.length} JS modules, packaged ${filesToCopy.length} files (${(totalBytes / 1024).toFixed(1)} KB) -> dist/ in ${elapsedMs}ms`);
}

buildDist();
