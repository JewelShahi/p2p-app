// clientTorrent.js
// ────────────────────────────────────────────────────────────────────────────
// Client-side (in-browser) torrent download using the PHONE/PC's own resources.
// The server does NOT download anything here — your device is the torrent client.
//
// HONEST LIMITATIONS (browser rules, not bugs):
//  • A browser can only reach WebRTC (WSS-tracker) peers + HTTP web seeds.
//    It CANNOT connect to classic TCP/UDP-only peers. Poorly-WebRTC-seeded
//    torrents will find few/no peers. That's a browser limitation everywhere.
//
// MEMORY SAFETY (this is what stops your phone crashing on huge files):
//  • We STREAM each file straight to disk as pieces arrive — nothing is kept
//    in RAM. Desktop Chrome/Edge use the File System Access API; Android Chrome
//    uses StreamSaver (a service worker). iOS Safari has no disk-stream API, so
//    we HARD-BLOCK huge files there instead of filling memory and crashing.
//  • Sequential download + low connection caps keep CPU/RAM moderate.
// ────────────────────────────────────────────────────────────────────────────

// Requires:  npm i webtorrent streamsaver
// (See vite note at bottom for the polyfills WebTorrent needs in the browser.)
import WebTorrent from 'webtorrent';
import streamSaver from 'streamsaver';

// ── Device / capability detection ──
const ua = navigator.userAgent || '';
const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
const isIOS = /iPhone|iPad|iPod/i.test(ua);

const deviceMemGB = navigator.deviceMemory || (isMobile ? 3 : 8); // rough hint

// Cap concurrent connections so we don't spike CPU/RAM on a phone.
const MAX_CONNS = isMobile ? 12 : 30;

// The biggest file we allow WITHOUT a real disk-streaming API (i.e. the Blob
// fallback, which would sit in RAM). Keeps memory safe on iOS Safari.
const BLOB_FALLBACK_MAX = Math.min(deviceMemGB, 4) * 0.25 * 1024 * 1024 * 1024; // ~25% of RAM, capped

const TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.webtorrent.dev',
];

// Feature checks for disk streaming.
const hasFsAccess = typeof window !== 'undefined' && 'showSaveFilePicker' in window;
// StreamSaver works on Chromium (incl. Android Chrome). It falls apart on iOS.
const canStreamSaver = !isIOS;

let _client = null;
function getClient() {
  if (_client && !_client.destroyed) return _client;
  _client = new WebTorrent({
    maxConns: MAX_CONNS,
    tracker: { announce: TRACKERS },
    // dht/lsd/utp are irrelevant in-browser; peers come via WSS + web seeds.
    webSeeds: true,
  });
  _client.on('error', (err) => console.error('[clientTorrent] client error', err?.message || err));
  return _client;
}

export function pickTargetFile(torrent, fileIndex) {
  if (fileIndex != null && torrent.files[fileIndex]) return torrent.files[fileIndex];
  if (torrent.files.length === 1) return torrent.files[0];
  return null; // caller decides (e.g. zip) for multi-file
}

// ── Disk writer strategies (all avoid holding the file in RAM, except Blob) ──
async function makeDiskWriter(fileName, totalSize) {
  // 1) Best: File System Access API (desktop Chrome/Edge). Writes to a real file.
  if (hasFsAccess) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: fileName });
      const writable = await handle.createWritable();
      return {
        kind: 'fsaccess',
        write: (chunk) => writable.write(chunk),
        close: () => writable.close(),
        abort: () => writable.abort().catch(() => {}),
      };
    } catch (err) {
      if (err?.name === 'AbortError') throw err; // user cancelled the save dialog
      // else fall through to next strategy
    }
  }

  // 2) Good on Android Chrome: StreamSaver (service-worker streamed download).
  if (canStreamSaver) {
    try {
      const stream = streamSaver.createWriteStream(fileName, totalSize ? { size: totalSize } : undefined);
      const writer = stream.getWriter();
      return {
        kind: 'streamsaver',
        write: (chunk) => writer.write(new Uint8Array(chunk)),
        close: () => writer.close(),
        abort: () => writer.abort().catch(() => {}),
      };
    } catch (err) {
      // fall through
    }
  }

  // 3) Last resort: Blob in memory. ONLY for small files — guard huge ones.
  if (totalSize && totalSize > BLOB_FALLBACK_MAX) {
    const gb = (BLOB_FALLBACK_MAX / 1024 / 1024 / 1024).toFixed(1);
    const err = new Error(
      `This browser can't stream large files to disk. To avoid crashing your device, files over ~${gb}GB are blocked here. ` +
      `Use Chrome/Edge on desktop, Chrome on Android, or download on a computer.`
    );
    err.code = 'NO_DISK_STREAM';
    throw err;
  }
  const parts = [];
  return {
    kind: 'blob',
    write: (chunk) => { parts.push(chunk); return Promise.resolve(); },
    close: () => {
      const blob = new Blob(parts);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      return Promise.resolve();
    },
    abort: () => { parts.length = 0; return Promise.resolve(); },
  };
}

// ── Public API: add a torrent and get its info (no download yet) ──
export function addTorrent(source, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const client = getClient();

    const existing = client.get(source);
    if (existing && !existing.destroyed) {
      if (existing.ready) return resolve(existing);
      existing.once('ready', () => resolve(existing));
      existing.once('error', reject);
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error('No peers found in time. In-browser torrents can only use WebRTC/WSS peers and web seeds — this torrent may not have any.'));
    }, timeoutMs);

    let torrent;
    try {
      torrent = client.add(source, { announce: TRACKERS });
    } catch (err) {
      clearTimeout(timer);
      return reject(err);
    }

    torrent.once('ready', () => { clearTimeout(timer); resolve(torrent); });
    torrent.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

export function getTorrentInfo(torrent) {
  return {
    name: torrent.name,
    infoHash: torrent.infoHash,
    totalSize: torrent.length,
    numPeers: torrent.numPeers,
    files: torrent.files.map((f, i) => ({ index: i, name: f.name, size: f.length, path: f.path })),
  };
}

// ── Download ONE file, streaming to disk, with progress + memory safety ──
// Returns a controller: { cancel() }.
export async function downloadFileToDisk(torrent, fileIndex, {
  onProgress,   // (fraction 0..1, receivedBytes, totalBytes) => void
  onStatus,     // (message) => void
  onDone,       // () => void
  onError,      // (Error) => void
} = {}) {
  const file = pickTargetFile(torrent, fileIndex);
  if (!file) {
    onError?.(new Error('No single target file — use downloadAllAsZip for multi-file torrents.'));
    return { cancel() {} };
  }

  let cancelled = false;
  let writer = null;

  try {
    onStatus?.('Preparing download…');

    // MEMORY SAFETY: create the disk writer BEFORE we start pulling bytes.
    writer = await makeDiskWriter(file.name, file.length);

    // Only download THIS file, in order (sequential) — nothing extra buffered.
    try {
      torrent.files.forEach((f) => f.deselect && f.deselect());
      file.select && file.select();
    } catch {}

    onStatus?.(torrent.numPeers > 0 ? `Downloading from ${torrent.numPeers} peer(s)…` : 'Connecting to peers…');

    const stream = file.createReadStream(); // yields pieces in order
    let received = 0;
    let lastTick = 0;

    const cleanup = () => {
      try { stream.destroy(); } catch {}
    };

    stream.on('data', async (chunk) => {
      if (cancelled) { cleanup(); return; }
      try {
        // Backpressure: pause the torrent stream while the disk write settles.
        stream.pause();
        await writer.write(chunk);
        received += chunk.length;

        const now = Date.now();
        if (now - lastTick > 150) {
          onProgress?.(file.length ? Math.min(received / file.length, 1) : 0, received, file.length);
          lastTick = now;
        }
        if (!cancelled) stream.resume();
      } catch (err) {
        cancelled = true;
        cleanup();
        try { await writer.abort(); } catch {}
        onError?.(err);
      }
    });

    stream.on('end', async () => {
      if (cancelled) return;
      try {
        await writer.close();
        onProgress?.(1, file.length, file.length);
        onDone?.();
      } catch (err) {
        onError?.(err);
      }
    });

    stream.on('error', async (err) => {
      if (cancelled) return;
      cancelled = true;
      try { await writer.abort(); } catch {}
      onError?.(err);
    });

    return {
      cancel: async () => {
        cancelled = true;
        cleanup();
        try { await writer?.abort(); } catch {}
      },
    };
  } catch (err) {
    try { await writer?.abort(); } catch {}
    onError?.(err);
    return { cancel() {} };
  }
}

// ── Download ALL files as a single .zip, streamed to disk (no full-RAM zip) ──
// Uses client-zip which produces a ReadableStream — memory stays low.
export async function downloadAllAsZip(torrent, {
  onProgress, onStatus, onDone, onError,
} = {}) {
  let cancelled = false;
  let writer = null;
  try {
    onStatus?.('Preparing zip…');
    const zipName = `${torrent.name || 'files'}.zip`;

    // Disk writer first (size unknown for a streamed zip → no size hint).
    writer = await makeDiskWriter(zipName, 0);

    // Lazy import so it doesn't bloat the main bundle.
    const { makeZip } = await import('client-zip');

    // Feed each torrent file as an async-iterable of chunks to client-zip.
    const totalSize = torrent.length || 0;
    let received = 0;
    let lastTick = 0;

    const inputs = torrent.files.map((f) => ({
      name: f.path || f.name,
      // client-zip accepts a stream/async-iterable as input
      input: (async function* () {
        const rs = f.createReadStream();
        for await (const chunk of rs) {
          if (cancelled) { try { rs.destroy(); } catch {} return; }
          received += chunk.length;
          const now = Date.now();
          if (now - lastTick > 150) {
            onProgress?.(totalSize ? Math.min(received / totalSize, 1) : 0, received, totalSize);
            lastTick = now;
          }
          yield chunk;
        }
      })(),
    }));

    onStatus?.('Zipping and streaming to disk…');
    const zipStream = makeZip(inputs); // ReadableStream of the zip

    const reader = zipStream.getReader();
    while (true) {
      if (cancelled) break;
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write(value);
    }

    if (!cancelled) {
      await writer.close();
      onProgress?.(1, totalSize, totalSize);
      onDone?.();
    }

    return {
      cancel: async () => { cancelled = true; try { await writer?.abort(); } catch {} },
    };
  } catch (err) {
    try { await writer?.abort(); } catch {}
    onError?.(err);
    return { cancel() {} };
  }
}

// Fully remove a torrent and free its memory/store.
export function removeTorrent(torrent) {
  try { torrent?.destroy({ destroyStore: true }); } catch {}
}

export function destroyClient() {
  try { _client?.destroy(); } catch {}
  _client = null;
}

export const capabilities = {
  isMobile,
  isIOS,
  hasFsAccess,
  canStreamSaver,
  maxConns: MAX_CONNS,
  blobFallbackMax: BLOB_FALLBACK_MAX,
};
