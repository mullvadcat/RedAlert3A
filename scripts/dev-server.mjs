import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootBase = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const useDist = process.argv.includes('--dist');
const serveRoot = useDist ? path.join(rootBase, 'dist') : rootBase;

let port = useDist ? 4173 : 5173;
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--port=')) {
    const parsed = Number.parseInt(arg.slice('--port='.length), 10);
    if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
      port = parsed;
    }
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2',
  '.hdr': 'application/octet-stream'
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; object-src 'none'; frame-ancestors 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cache-Control': 'no-store'
};

function sendError(res, status, msg) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(msg);
}

const server = http.createServer((req, res) => {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    sendError(res, 405, 'Method Not Allowed');
    return;
  }

  let rawPath = '/';
  try {
    const reqUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    rawPath = decodeURIComponent(reqUrl.pathname);
  } catch {
    sendError(res, 400, 'Bad Request');
    return;
  }

  if (rawPath.includes('\0') || rawPath.includes('\\')) {
    sendError(res, 400, 'Invalid Path');
    return;
  }

  const normalizedRel = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '');
  let targetPath = path.resolve(serveRoot, normalizedRel);

  if (targetPath !== serveRoot && !targetPath.startsWith(serveRoot + path.sep)) {
    sendError(res, 403, 'Forbidden');
    return;
  }

  if (!fs.existsSync(targetPath)) {
    sendError(res, 404, 'Not Found');
    return;
  }

  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) {
    targetPath = path.resolve(targetPath, 'index.html');
    if (!targetPath.startsWith(serveRoot + path.sep) || !fs.existsSync(targetPath)) {
      sendError(res, 404, 'Not Found');
      return;
    }
  }

  const ext = path.extname(targetPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': contentType });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(targetPath).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[server] RedAlert3A listening on http://127.0.0.1:${port}/ (${useDist ? 'dist' : 'dev'})`);
});
