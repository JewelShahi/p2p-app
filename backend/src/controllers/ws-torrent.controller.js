import client from '../utils/torrentClient.js';

const isValidSource = (s) => {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  return t.startsWith('magnet:') || t.startsWith('http://') || t.startsWith('https://');
};

function getTorrent(source, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const existing = client.get(source);
    
    let existingTorrent = null;
    
    // FIXED: Strictly check if it's a real Torrent object by looking for the .once method
    if (existing && typeof existing === 'object' && typeof existing.once === 'function' && !existing.destroyed) {
      existingTorrent = existing;
    } 
    else if (typeof existing === 'string') {
      existingTorrent = client.torrents.find(t => t.infoHash === existing && !t.destroyed) || null;
    }

    if (existingTorrent) {
      if (existingTorrent.ready) return resolve(existingTorrent);
      const timer = setTimeout(() => reject(new Error('Timeout')), timeoutMs);
      existingTorrent.once('ready', () => { clearTimeout(timer); resolve(existingTorrent); });
      existingTorrent.once('error', (err) => { clearTimeout(timer); reject(err); });
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error('Could not get torrent metadata. No seeders found or DHT-only torrent.'));
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
          const t2 = setTimeout(() => reject(new Error('Timeout')), timeoutMs);
          dup.once('ready', () => { clearTimeout(t2); resolve(dup); });
          dup.once('error', (e) => { clearTimeout(t2); reject(e); });
          return;
        }
      }
      reject(err);
    });
  });
}

export function handleWsTorrentUpgrade(wss, req, socket, head) {
  const ws = wss.handleUpgrade(req, socket, head);
  let closed = false;

  const timeout = setTimeout(() => {
    if (!closed && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: 'Timed out waiting for peers.' }));
      ws.close();
    }
  }, 90 * 60 * 1000);

  const safeSend = (data) => {
    if (!closed && ws.readyState === ws.OPEN) ws.send(data);
  };

  const safeClose = () => {
    if (!closed) {
      closed = true;
      clearTimeout(timeout);
      try { ws.close(); } catch {}
    }
  };

  ws.on('close', () => { closed = true; clearTimeout(timeout); });

  ws.on('message', async (rawMsg) => {
    let msg;
    try { msg = JSON.parse(rawMsg); } catch { return; }

    if (msg.type !== 'start') return;

    const source = msg.magnet;
    const fileIndex = msg.fileIndex !== undefined ? parseInt(msg.fileIndex, 10) : null;

    if (!isValidSource(source)) {
      safeSend(JSON.stringify({ type: 'error', message: 'Invalid magnet or URL' }));
      safeClose();
      return;
    }

    try {
      const torrent = await getTorrent(source);

      let targetFile;
      if (fileIndex !== null && torrent.files[fileIndex]) {
        targetFile = torrent.files[fileIndex];
      } else if (torrent.files.length === 1) {
        targetFile = torrent.files[0];
      }

      if (targetFile) {
        safeSend(JSON.stringify({ type: 'meta', name: targetFile.name, size: targetFile.length }));
        const stream = targetFile.createReadStream();

        stream.on('data', (chunk) => {
          if (closed) return stream.destroy();
          if (ws.bufferedAmount > 4 * 1024 * 1024) {
            stream.pause();
            const onDrain = () => { stream.resume(); ws.removeListener('drain', onDrain); };
            ws.on('drain', onDrain);
          }
          safeSend(chunk);
        });

        stream.on('end', () => { safeSend(JSON.stringify({ type: 'done' })); safeClose(); });
        stream.on('error', (err) => { safeSend(JSON.stringify({ type: 'error', message: 'Stream error: ' + err.message })); safeClose(); });

      } else {
        const { default: archiver } = await import('archiver');
        safeSend(JSON.stringify({ type: 'meta', name: torrent.name + '.zip', size: torrent.length }));

        const archive = archiver('zip', { zlib: { level: 1 } });
        archive.on('error', (err) => { safeSend(JSON.stringify({ type: 'error', message: 'Zip error: ' + err.message })); safeClose(); });

        for (const file of torrent.files) {
          archive.append(file.createReadStream(), { name: file.path });
        }

        archive.on('data', (chunk) => {
          if (closed) return archive.destroy();
          if (ws.bufferedAmount > 4 * 1024 * 1024) {
            archive.pause();
            const onDrain = () => { archive.resume(); ws.removeListener('drain', onDrain); };
            ws.on('drain', onDrain);
          }
          safeSend(chunk);
        });

        archive.on('end', () => { safeSend(JSON.stringify({ type: 'done' })); safeClose(); });
        archive.finalize();
      }
    } catch (err) {
      safeSend(JSON.stringify({ type: 'error', message: err.message || 'Failed to resolve torrent.' }));
      safeClose();
    }
  });
}