import WebTorrent from 'webtorrent';

// Single shared WebTorrent client for the whole server — all magnet
// requests (info + download) reuse this instance.
const client = new WebTorrent();

// Without this listener, an error on any individual torrent (e.g. adding a
// magnet that's already active) throws uncaught and kills the entire process.
client.on('error', (err) => {
  console.error('[WebTorrent client error]', err?.message || err);
});

export default client;