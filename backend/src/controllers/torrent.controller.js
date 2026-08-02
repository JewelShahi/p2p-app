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

function getOrAdd(source, onTorrent, onError) {
  try {
    // 1. Check if WebTorrent already knows about this torrent.
    // client.get() can return a Torrent object OR just an infoHash string
    // depending on the WebTorrent version, so we handle both.
    const existing = client.get(source);
    let existingTorrent = null;

    if (existing) {
      if (typeof existing === 'object' && typeof existing.once === 'function') {
        // It's a valid torrent object
        existingTorrent = existing;
      } else if (typeof existing === 'string') {
        // It's just the infoHash string — find the actual object in the client's list
        existingTorrent = client.torrents.find(t => t.infoHash === existing) || null;
      }
    }

    if (existingTorrent) {
      if (existingTorrent.ready) {
        onTorrent(existingTorrent);
      } else {
        existingTorrent.once('ready', () => onTorrent(existingTorrent));
        existingTorrent.once('error', (err) => {
          console.error('[getOrAdd existing error]', err.message);
          onError?.(err);
        });
      }
      return; // Stop here, we found it!
    }

    // 2. If not found, add it
    const torrent = client.add(source, { destroyStoreOnDestroy: true }, (t) => {
      onTorrent(t);
    });

    // 3. Catch errors that happen DURING handshake
    torrent.on('error', (err) => {
      // If it failed because it was actually added in a race condition,
      // try to recover by finding it in the client's active list.
      if (err.message && err.message.includes('Cannot add duplicate')) {
        console.log('[getOrAdd] Recovering from duplicate add...');
        const dup = client.torrents.find(t => t.infoHash === existing) || client.torrents[client.torrents.length - 1];
        if (dup) {
          if (dup.ready) onTorrent(dup);
          else dup.once('ready', () => onTorrent(dup));
          return;
        }
      }
      console.error('[getOrAdd new error]', err.message);
      onError?.(err);
    });

  } catch (err) {
    console.error('[getOrAdd sync throw]', err.message);
    onError?.(err);
  }
}

// Helper to safely send a response exactly once
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