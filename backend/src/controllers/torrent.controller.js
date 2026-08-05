import client from '../utils/torrentClient.js';

const isValidSource = (s) => {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  return t.startsWith('magnet:') || t.startsWith('http://') || t.startsWith('https://');
};

// Centralized promise wrapper to safely handle WebTorrent's async behavior
function getTorrent(source, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const existing = client.get(source);

    let existingTorrent = null;
    
    // client.get() can return a string (infoHash) or an invalid internal object.
    // We STRICTLY check for .once to ensure it's a real Torrent instance.
    if (existing && typeof existing === 'object' && typeof existing.once === 'function' && !existing.destroyed) {
      existingTorrent = existing;
    } 
    // Fallback if it returned just the infoHash string
    else if (typeof existing === 'string') {
      existingTorrent = client.torrents.find(t => t.infoHash === existing && !t.destroyed) || null;
    }

    if (existingTorrent) {
      if (existingTorrent.ready) return resolve(existingTorrent);
      const timer = setTimeout(() => reject(new Error('Timeout waiting for torrent to ready')), timeoutMs);
      existingTorrent.once('ready', () => { clearTimeout(timer); resolve(existingTorrent); });
      existingTorrent.once('error', (err) => { clearTimeout(timer); reject(err); });
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error('Could not get torrent metadata. The torrent may have no seeders, or uses DHT-only discovery (disabled on this server).'));
    }, timeoutMs);

    let torrent;
    try {
      torrent = client.add(source, {
        destroyStoreOnDestroy: true,
        announce: [
          'wss://tracker.openwebtorrent.com',
          'wss://tracker.btorrent.xyz',
          'wss://tracker.fastcast.nz'
        ]
      });
      torrent._addedAt = Date.now();
    } catch (err) {
      clearTimeout(timer);
      return reject(err);
    }

    torrent.once('ready', () => { clearTimeout(timer); resolve(torrent); });

    torrent.once('error', (err) => {
      clearTimeout(timer);
      if (err.message?.includes('Cannot add duplicate') || err.message?.includes('already in client')) {
        const dup = client.torrents.find(t => t.infoHash === torrent.infoHash && !t.destroyed);
        if (dup) {
          if (dup.ready) return resolve(dup);
          const t2 = setTimeout(() => reject(new Error('Timeout waiting for duplicate torrent')), timeoutMs);
          dup.once('ready', () => { clearTimeout(t2); resolve(dup); });
          dup.once('error', (e) => { clearTimeout(t2); reject(e); });
          return;
        }
      }
      reject(err);
    });
  });
}

// GET /api/torrent/info
export const getInfo = async (req, res, next) => {
  try {
    const { magnet } = req.query;
    if (!isValidSource(magnet)) {
      return res.status(400).json({ ok: false, error: 'Invalid magnet link or URL' });
    }

    // CRITICAL: Block direct file URLs (like .iso, .zip, .exe).
    // WebTorrent only accepts magnet links or URLs to .torrent files.
    if ((magnet.startsWith('http://') || magnet.startsWith('https://')) && !magnet.toLowerCase().endsWith('.torrent')) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Direct file URLs are not supported. Please use a magnet link or a URL pointing to a .torrent file.' 
      });
    }

    const torrent = await getTorrent(magnet);

    res.json({
      ok: true,
      name: torrent.name,
      infoHash: torrent.infoHash,
      totalSize: torrent.length,
      files: torrent.files.map((f, i) => ({
        index: i,
        name: f.name,
        size: f.length,
        path: f.path
      }))
    });
  } catch (err) {
    // Catch bencode parse errors from bad URLs/Files
    if (err.message && err.message.includes('not a number')) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid torrent file. The URL did not return valid torrent data.' 
      });
    }
    next(err);
  }
};

// GET /api/torrent/download
export const download = async (req, res, next) => {
  try {
    const { magnet, fileIndex } = req.query;
    if (!isValidSource(magnet)) {
      return res.status(400).json({ ok: false, error: 'Invalid magnet link or URL' });
    }

    // CRITICAL: Block direct file URLs here too
    if ((magnet.startsWith('http://') || magnet.startsWith('https://')) && !magnet.toLowerCase().endsWith('.torrent')) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Direct file URLs are not supported. Please use a magnet link or a URL pointing to a .torrent file.' 
      });
    }

    const idx = fileIndex !== undefined ? parseInt(fileIndex, 10) : null;
    const torrent = await getTorrent(magnet, 120000); // 2 min timeout for downloads

    let targetFile;
    if (idx !== null && torrent.files[idx]) {
      targetFile = torrent.files[idx];
    } else if (torrent.files.length === 1) {
      targetFile = torrent.files[0];
    }

    if (targetFile) {
      // Single file download
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(targetFile.name)}`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', targetFile.length);

      const stream = targetFile.createReadStream();
      stream.pipe(res);

      stream.on('error', (err) => {
        console.error('[Download stream error]', err.message);
        if (!res.headersSent) res.status(500).end();
        else res.end();
      });

      res.on('close', () => stream.destroy());
    } else {
      // Multiple files -> zip
      const { default: archiver } = await import('archiver');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(torrent.name + '.zip')}`);
      res.setHeader('Content-Type', 'application/zip');

      const archive = archiver('zip', { zlib: { level: 1 } });
      archive.pipe(res);

      for (const file of torrent.files) {
        archive.append(file.createReadStream(), { name: file.path });
      }

      archive.finalize();

      archive.on('error', (err) => {
        console.error('[Zip error]', err.message);
        if (!res.headersSent) res.status(500).end();
        else res.end();
      });
    }
  } catch (err) {
    // Catch bencode parse errors here too
    if (err.message && err.message.includes('not a number')) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid torrent file. The URL did not return valid torrent data.' 
      });
    }
    next(err);
  }
};