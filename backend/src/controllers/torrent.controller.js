// archiver is a CommonJS package and doesn't expose a clean ESM default
// export, so Node's loader can't auto-detect it — pull it in via createRequire instead.
import { createRequire } from 'module';
import client from '../utils/torrentClient.js';

const require = createRequire(import.meta.url);
const archiver = require('archiver');

const ADD_TIMEOUT_MS = 30_000; // fail fast if a magnet has no reachable peers/metadata

// If the same magnet is already active on the shared client (two requests for
// the same file, a double-click, etc.), reuse it instead of calling
// client.add() again — adding a duplicate throws and previously crashed the process.
function getOrAdd(magnet, onTorrent) {
  const existing = client.get(magnet);
  if (existing) {
    if (existing.ready) onTorrent(existing);
    else existing.once('ready', () => onTorrent(existing));
    return;
  }
  client.add(magnet, { destroyStoreOnDestroy: true }, onTorrent);
}

// GET /api/torrent/info?magnet=<uri>
// Resolves metadata only (file list + sizes) without downloading data,
// so the frontend can show "here's what this magnet contains" before committing.
export function getInfo(req, res) {
  const magnet = req.query.magnet;
  if (!magnet || !magnet.startsWith('magnet:')) {
    return res.status(400).json({ ok: false, error: 'valid magnet link required' });
  }

  let settled = false;
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    res.status(504).json({ ok: false, error: 'timed out resolving magnet metadata' });
  }, ADD_TIMEOUT_MS);

  getOrAdd(magnet, (torrent) => {
    if (settled) return; // a concurrent request for the same magnet may already be handling this
    settled = true;
    clearTimeout(timeout);

    res.json({
      ok: true,
      name: torrent.name,
      infoHash: torrent.infoHash,
      totalSize: torrent.length,
      files: torrent.files.map((f, i) => ({ index: i, name: f.name, size: f.length })),
    });
    // No torrent.destroy() here — a concurrent request for the same magnet
    // may still be attached to this same shared torrent instance.
  });
}

// GET /api/torrent/download?magnet=<uri>&fileIndex=<n>
// Streams a single file straight through to the HTTP response.
// Omit fileIndex to auto-pick the only file, or zip everything if there are multiple.
export function download(req, res) {
  const magnet = req.query.magnet;
  const fileIndex = req.query.fileIndex !== undefined ? parseInt(req.query.fileIndex, 10) : null;

  if (!magnet || !magnet.startsWith('magnet:')) {
    return res.status(400).json({ ok: false, error: 'valid magnet link required' });
  }

  let settled = false;
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    res.status(504).json({ ok: false, error: 'timed out finding peers for this magnet' });
  }, ADD_TIMEOUT_MS);

  getOrAdd(magnet, (torrent) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);

    let targetFile;
    if (fileIndex !== null && torrent.files[fileIndex]) {
      targetFile = torrent.files[fileIndex];
    } else if (torrent.files.length === 1) {
      targetFile = torrent.files[0];
    } else {
      return streamAsZip(torrent, res);
    }

    res.setHeader('Content-Disposition', `attachment; filename="${sanitize(targetFile.name)}"`);
    res.setHeader('Content-Length', targetFile.length);
    res.setHeader('Content-Type', 'application/octet-stream');

    const stream = targetFile.createReadStream();
    stream.pipe(res);

    stream.on('error', () => {
      if (!res.headersSent) res.status(500).json({ ok: false, error: 'stream error' });
    });

    const cleanup = () => torrent.destroy();
    stream.on('end', cleanup);
    req.on('close', cleanup);
  });
}

function streamAsZip(torrent, res) {
  res.setHeader('Content-Disposition', `attachment; filename="${sanitize(torrent.name)}.zip"`);
  res.setHeader('Content-Type', 'application/zip');

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', () => {
    if (!res.headersSent) res.status(500).end();
  });
  archive.pipe(res);

  for (const file of torrent.files) {
    archive.append(file.createReadStream(), { name: file.path });
  }
  archive.finalize();

  const cleanup = () => torrent.destroy();
  archive.on('end', cleanup);
  res.on('close', cleanup);
}

function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}