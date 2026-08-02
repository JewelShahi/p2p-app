import WebTorrent from 'webtorrent';

const client = new WebTorrent({ 
  dht: false, 
  utp: false 
});

client.on('error', (err) => {
  console.error('[WebTorrent client error]', err?.message || err);
});

export default client;