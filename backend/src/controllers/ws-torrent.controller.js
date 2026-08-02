import { WebSocketServer } from 'ws';
import { createRequire } from 'module';
import client from '../utils/torrentClient.js';

const require = createRequire(import.meta.url);
const archiver = require('archiver');

const isValidTorrentSource = (source) => {
  if (!source || typeof source !== 'string') return false;
  const trimmed = source.trim();
  return trimmed.startsWith('magnet:') || trimmed.startsWith('http://') || trimmed.startsWith('https://');
};

function getOrAdd(source, onTorrent, onError) {
  try {
    const existing = client.get(source);
    let existingTorrent = null;

    if (existing) {
      if (typeof existing === 'object' && typeof existing.once === 'function') {
        existingTorrent = existing;
      } else if (typeof existing === 'string') {
        existingTorrent = client.torrents.find(t => t.infoHash === existing) || null;
      }
    }

    if (existingTorrent) {
      if (existingTorrent.ready) onTorrent(existingTorrent);
      else {
        existingTorrent.once('ready', () => onTorrent(existingTorrent));
        existingTorrent.once('error', (err) => onError?.(err));
      }
      return;
    }

    const torrent = client.add(source, { destroyStoreOnDestroy: true }, (t) => onTorrent(t));
    torrent.on('error', (err) => {
      if (err.message?.includes('Cannot add duplicate')) {
        const dup = client.torrents.find(t => t.infoHash === existing) || client.torrents[client.torrents.length - 1];
        if (dup) {
          if (dup.ready) onTorrent(dup);
          else dup.once('ready', () => onTorrent(dup));
          return;
        }
      }
      onError?.(err);
    });
  } catch (err) {
    onError?.(err);
  }
}

export function handleWsTorrentUpgrade(wss, req, socket, head) {
  const ws = wss.handleUpgrade(req, socket, head);
  
  // 60 minute timeout for finding peers + downloading
  const timeout = setTimeout(() => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: 'Timed out.' }));
      ws.close();
    }
  }, 60 * 60 * 1000);

  ws.on('close', () => clearTimeout(timeout));

  ws.on('message', (rawMsg) => {
    let msg;
    try { msg = JSON.parse(rawMsg); } catch { return; }

    if (msg.type === 'start') {
      const source = msg.magnet;
      const fileIndex = msg.fileIndex !== undefined ? parseInt(msg.fileIndex, 10) : null;

      if (!isValidTorrentSource(source)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid magnet or URL' }));
        ws.close();
        return;
      }

      getOrAdd(
        source,
        (torrent) => {
          let targetFile;
          if (fileIndex !== null && torrent.files[fileIndex]) {
            targetFile = torrent.files[fileIndex];
          } else if (torrent.files.length === 1) {
            targetFile = torrent.files[0];
          }

          if (!targetFile) {
            return streamAsZip(ws, torrent, timeout);
          }

          // Tell the browser the file name and total size so it can show progress
          ws.send(JSON.stringify({ 
            type: 'meta', 
            name: targetFile.name, 
            size: targetFile.length 
          }));

          // Stream chunks directly to the browser
          const stream = targetFile.createReadStream();
          
          stream.on('data', (chunk) => {
            // Backpressure: pause if the browser/network is falling behind
            if (ws.bufferedAmount > 2 * 1024 * 1024) {
              stream.pause();
              ws.once('drain', () => stream.resume());
            }
            ws.send(chunk);
          });

          stream.on('end', () => {
            ws.send(JSON.stringify({ type: 'done' }));
            clearTimeout(timeout);
            torrent.destroy();
          });

          stream.on('error', (err) => {
            ws.send(JSON.stringify({ type: 'error', message: 'Stream error: ' + err.message }));
            clearTimeout(timeout);
            ws.close();
          });
        },
        (err) => {
          ws.send(JSON.stringify({ type: 'error', message: err.message || 'Failed to resolve torrent.' }));
          clearTimeout(timeout);
          ws.close();
        }
      );
    }
  });
}

function streamAsZip(ws, torrent, timeout) {
  ws.send(JSON.stringify({ 
    type: 'meta', 
    name: `${torrent.name}.zip`, 
    size: torrent.length 
  }));

  const archive = archiver('zip', { zlib: { level: 1 } }); // Level 1 for speed
  archive.on('error', (err) => {
    ws.send(JSON.stringify({ type: 'error', message: 'Zip error: ' + err.message }));
    clearTimeout(timeout);
    ws.close();
  });

  for (const file of torrent.files) {
    archive.append(file.createReadStream(), { name: file.path });
  }

  archive.on('data', (chunk) => {
    if (ws.bufferedAmount > 2 * 1024 * 1024) {
      archive.pause();
      ws.once('drain', () => archive.resume());
    }
    ws.send(chunk);
  });

  archive.on('end', () => {
    ws.send(JSON.stringify({ type: 'done' }));
    clearTimeout(timeout);
    torrent.destroy();
  });

  archive.finalize();
}