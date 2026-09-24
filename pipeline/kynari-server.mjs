#!/usr/bin/env node
/**
 * KYNARI SERVER v3 — fix SyntaxError JS en panel
 * El HTML ahora se sirve desde kynari-panel.html (fichero separado)
 * para evitar problemas de escapes en template literals de Node.
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4173;
const PUBLISHER_PATH = path.join(__dirname, 'kynari-publisher.mjs');
const LOG_PATH = path.join(__dirname, 'kynari-log.json');
const HTML_PATH = path.join(__dirname, 'kynari-panel.html');

const jobs = new Map();

function startJob(args) {
  const jobId = crypto.randomUUID();
  const job = { output: '', done: false, code: null };
  jobs.set(jobId, job);
  const child = spawn(process.execPath, [PUBLISHER_PATH, ...args], {
    cwd: __dirname,
    env: process.env
  });
  child.stdout.on('data', (chunk) => { job.output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { job.output += chunk.toString(); });
  child.on('close', (code) => { job.done = true; job.code = code; });
  child.on('error', (err) => {
    job.output += `\n[No se pudo lanzar el proceso: ${err.message}]\n`;
    job.done = true;
    job.code = -1;
  });
  return jobId;
}

async function getRecentLog(n = 10) {
  try {
    const raw = await fs.readFile(LOG_PATH, 'utf-8');
    const log = JSON.parse(raw);
    return log.filter((e) => e.status === 'success' && e.title).slice(-n).reverse();
  } catch {
    return [];
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/') {
    try {
      const html = await fs.readFile(HTML_PATH, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end('No se encontró kynari-panel.html en la misma carpeta.');
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/log') {
    const entries = await getRecentLog(10);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(entries));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/run') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch { res.writeHead(400); res.end('JSON invalido'); return; }

      const args = [];
      if (payload.mode === 'daily') {
        args.push('daily');
      } else if (payload.mode === 'legacy') {
        args.push('legacy');
      } else if (payload.mode === 'custom') {
        args.push('custom', '--topic', payload.topic || '', '--category', payload.category || 'Culture', '--section', payload.section || 'Featured');
        if (payload.angle) args.push('--angle', payload.angle);
        if (payload.youtube) args.push('--youtube', payload.youtube);
      } else {
        res.writeHead(400); res.end('Modo desconocido'); return;
      }
      const jobId = startJob(args);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jobId }));
    });
    return;
  }

  const statusMatch = url.pathname.match(/^\/api\/status\/([a-f0-9-]+)$/);
  if (req.method === 'GET' && statusMatch) {
    const job = jobs.get(statusMatch[1]);
    if (!job) { res.writeHead(404); res.end('Job no encontrado'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ output: job.output, done: job.done, code: job.code }));
    return;
  }

  res.writeHead(404);
  res.end('No encontrado');
});

server.listen(PORT, () => {
  console.log(`Kynari Server v3 escuchando en http://localhost:${PORT}`);
  console.log('Deja esta ventana abierta mientras uses el panel en el navegador.');
});
