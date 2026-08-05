import client from '../utils/torrentClient.js';

const isValidSource = (s) => {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  return t.startsWith('magnet:') || t.startsWith('http://') || t.startsWith('https://');
};

function getTorrent(source, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const existing = client.get(source);

    let existingTorrent = null;
    
    // FIXED: Strictly check if it's a real Torrent object by looking for the .once method
    if (existing && typeof existing === 'object' && typeof existing.once === 'function' && !existing.destroyed) {
      existingTorrent = existing;
    } 
    // Sometimes it returns just the infoHash string
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

export const getInfo = async (req, res, next) => {
  try {
    const { magnet } = req.query;
    if (!isValidSource(magnet)) {
      return res.status(400).json({ ok: false, error: 'Invalid magnet link or URL' });
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
    next(err);
  }
};

export const download = async (req, res, next) => {
  try {
    const { magnet, fileIndex } = req.query;
    if (!isValidSource(magnet)) {
      return res.status(400).json({ ok: false, error: 'Invalid magnet link or URL' });
    }

    const idx = fileIndex !== undefined ? parseInt(fileIndex, 10) : null;
    const torrent = await getTorrent(magnet, 120000);

    let targetFile;
    if (idx !== null && torrent.files[idx]) {
      targetFile = torrent.files[idx];
    } else if (torrent.files.length === 1) {
      targetFile = torrent.files[0];
    }

    if (targetFile) {
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
    next(err);
  }
};