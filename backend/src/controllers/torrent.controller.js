import { createRequire } from 'module';
import client from '../utils/torrentClient.js';

const require = createRequire(import.meta.url);
const archiver = require('archiver');

const ADD_TIMEOUT_MS = 30_000;

const isValidTorrentSource = (source) => {
  if (!source || typeof source !== 'string') return false;
  const trimmed = source.trim();
  return trimmed.startsWith('magnet:') || trimmed.startsWith('http://') || trimmed.startsWith('https://');
};

// Safely adds a torrent. 
// NOTE: We do NOT use client.get() here because it behaves unpredictably 
// with URLs vs infoHashes. client.add() natively handles duplicates anyway — 
// if the torrent is already active, it just calls the callback with it.
function getOrAdd(source, onTorrent, onError) {
  try {
    const torrent = client.add(source, { destroyStoreOnDestroy: true }, (t) => {
      onTorrent(t);
    });

    // Catch errors during handshake/metadata resolution
    torrent.on('error', (err) => {
      console.error('[getOrAdd error]', err.message);
      onError?.(err);
    });

  } catch (err) {
    console.error('[getOrAdd sync throw]', err.message);
    onError?.(err);
  }
}

// Helper to safely send a response exactly once (prevents ERR_HTTP_HEADERS_SENT)
const safeResponse = (res, settledRef, timeoutRef) => ({
  success: (data) => {
    if (settledRef.current) return;
    settledRef.current = true;
    clearTimeout(timeoutRef.current);
    res.json(data);
  },
  error: (code, msg) => {
    if (settledRef.current) return;
    settledRef.current = true;
    clearTimeout(timeoutRef.current);
    res.status(code).json({ ok: false, error: msg });
  }
});

// GET /api/torrent/info?magnet=<uri_or_url>
export function getInfo(req, res) {
  let source = req.query.magnet;
  if (Array.isArray(source)) source = source[0];

  if (!isValidTorrentSource(source)) {
    return res.status(400).json({ ok: false, error: 'Valid magnet link or .torrent URL required' });
  }

  const settled = { current: false };
  const timeout = { current: setTimeout(() => {
    safeResponse(res, settled, timeout).error(504, 'Timed out resolving torrent. If using a magnet link, your server might block WebTorrent traffic (common on Render free tier). Try a .torrent URL instead.');
  }, ADD_TIMEOUT_MS) };

  const { success, error } = safeResponse(res, settled, timeout);

  getOrAdd(
    source,
    (torrent) => {
      if (!torrent.files || torrent.files.length === 0) {
        return error(500, 'Torrent resolved but contains no files.');
      }
      success({
        ok: true,
        name: torrent.name,
        infoHash: torrent.infoHash,
        totalSize: torrent.length,
        files: torrent.files.map((f, i) => ({ index: i, name: f.name, size: f.length })),
      });
    },
    (err) => {
      let message = 'Failed to resolve torrent.';
      if (err?.message?.includes('UDP') || err?.message?.includes('EADDRINUSE') || err?.message?.includes('network')) {
        message = 'Server network restrictions (common on Render free tier) are blocking WebTorrent. Try using a direct .torrent URL instead of a magnet link.';
      } else if (err?.message?.includes('timed out') || err?.message?.includes('tracker')) {
        message = 'Could not connect to trackers. The torrent might be dead.';
      }
      error(500, message);
    }
  );
}

// GET /api/torrent/download?magnet=<uri_or_url>&fileIndex=<n>
export function download(req, res) {
  let source = req.query.magnet;
  if (Array.isArray(source)) source = source[0];
  const fileIndex = req.query.fileIndex !== undefined ? parseInt(req.query.fileIndex, 10) : null;

  if (!isValidTorrentSource(source)) {
    return res.status(400).json({ ok: false, error: 'Valid magnet link or .torrent URL required' });
  }

  const settled = { current: false };
  const timeout = { current: setTimeout(() => {
    safeResponse(res, settled, timeout).error(504, 'Timed out finding peers for this torrent.');
  }, ADD_TIMEOUT_MS) };

  const { success, error } = safeResponse(res, settled, timeout);

  getOrAdd(
    source,
    (torrent) => {
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
    },
    (err) => {
      error(500, `Failed to start download: ${err?.message || 'Unknown error'}`);
    }
  );
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