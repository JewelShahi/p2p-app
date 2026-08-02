import { createRequire } from 'module';
import client from '../utils/torrentClient.js';

const require = createRequire(import.meta.url);
const archiver = require('archiver');

const ADD_TIMEOUT_MS = 30_000;

const isValidTorrentSource = (source) => {
  if (!source || typeof source !== 'string') return false;
  return source.startsWith('magnet:') || source.startsWith('http://') || source.startsWith('https://');
};

function getOrAdd(source, onTorrent) {
  const existing = client.get(source);
  if (existing) {
    if (existing.ready) onTorrent(existing);
    else existing.once('ready', () => onTorrent(existing));
    return;
  }
  client.add(source, { destroyStoreOnDestroy: true }, onTorrent);
}

export function getInfo(req, res) {
  const source = req.query.magnet;
  if (!isValidTorrentSource(source)) {
    return res.status(400).json({ ok: false, error: 'Valid magnet link or .torrent URL required' });
  }

  let settled = false;
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    res.status(504).json({ ok: false, error: 'Timed out resolving torrent metadata' });
  }, ADD_TIMEOUT_MS);

  getOrAdd(source, (torrent) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);

    res.json({
      ok: true,
      name: torrent.name,
      infoHash: torrent.infoHash,
      totalSize: torrent.length,
      files: torrent.files.map((f, i) => ({ index: i, name: f.name, size: f.length })),
    });
  });
}

export function download(req, res) {
  const source = req.query.magnet;
  const fileIndex = req.query.fileIndex !== undefined ? parseInt(req.query.fileIndex, 10) : null;

  if (!isValidTorrentSource(source)) {
    return res.status(400).json({ ok: false, error: 'Valid magnet link or .torrent URL required' });
  }

  let settled = false;
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    res.status(504).json({ ok: false, error: 'Timed out finding peers for this torrent' });
  }, ADD_TIMEOUT_MS);

  getOrAdd(source, (torrent) => {
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