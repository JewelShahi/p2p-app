import WebTorrent from 'webtorrent';

// dht: false and utp: false are REQUIRED for Render free tier.
// Without these, WebTorrent tries to open UDP ports, which Render blocks.
const client = new WebTorrent({ 
  dht: false, 
  utp: false 
});

client.on('error', (err) => {
  console.error('[WebTorrent client error]', err?.message || err);
});

export default client;