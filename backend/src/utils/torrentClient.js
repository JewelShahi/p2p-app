import WebTorrent from 'webtorrent';

// dht: false and utp: false are REQUIRED for Render free tier.
const client = new WebTorrent({
  dht: false,
  utp: false,
  maxConns: 55,
  tracker: true,
  webSeeds: true
});

client.on('error', (err) => {
  console.error('[WebTorrent error]', err?.message || err);
});

// Auto-cleanup stuck torrents
setInterval(() => {
  const now = Date.now();
  for (const torrent of [...client.torrents]) {
    if (torrent.destroyed) continue;
    if (!torrent.ready && torrent._addedAt && now - torrent._addedAt > 3 * 60 * 1000) {
      console.log('[WebTorrent] Destroying stuck torrent:', torrent.infoHash);
      torrent.destroy().catch(() => {});
    }
  }
}, 60 * 1000);

export default client;