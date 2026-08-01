#!/usr/bin/env node
// Tiny zero-dependency static file server for local development.
//
// Serves the repository root over HTTP so `index.html` can load
// `<script type="module">` files correctly (browsers block ES module
// imports from `file://` URLs, so `npm start` / this script is the
// supported way to run the app locally).

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// `new URL('..', ...)` yields a directory URL (trailing slash), and
// `fileURLToPath` preserves that trailing separator on POSIX; strip it so
// `ROOT + sep` prefix checks below behave consistently.
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[/\\]+$/, '');
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.gguf': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function contentTypeFor(path) {
  return MIME_TYPES[extname(path).toLowerCase()] || 'application/octet-stream';
}

/** Resolves a request path to a file under ROOT, rejecting path traversal. */
function resolveRequestPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = normalize(join(ROOT, relative));
  if (resolved !== ROOT && !resolved.startsWith(ROOT + sep)) {
    return null; // path traversal attempt
  }
  return resolved;
}

const server = createServer(async (req, res) => {
  const path = resolveRequestPath(req.url || '/');
  if (!path) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad request');
    return;
  }

  try {
    const info = await stat(path);
    const filePath = info.isDirectory() ? join(path, 'index.html') : path;
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
    res.end(body);
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error');
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`gguf-editor dev server running at http://${HOST}:${PORT}/`);
});
