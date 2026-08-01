import SimplePeer from 'simple-peer';

const CHUNK_SIZE = 16 * 1024;
const BACKPRESSURE_LIMIT = 4 * 1024 * 1024;

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // Free public TURN for testing — openrelay.metered.ca. Swap for your own
  // coturn server before production; free relays are rate-limited/unreliable.
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export function createPeerConnection({ initiator, socket, targetSocketId, onFailed }) {
  const peer = new SimplePeer({
    initiator,
    trickle: true,
    config: { iceServers: ICE_SERVERS },
  });
  peer.on('signal', (signal) => {
    socket.emit('signal', { targetSocketId, signal });
  });

  // simple-peer doesn't always surface ICE failure as an 'error' event —
  // watch the underlying RTCPeerConnection directly so a dead connection
  // doesn't just sit silently at 0% forever.
  peer._pc?.addEventListener?.('iceconnectionstatechange', () => {
    const state = peer._pc.iceConnectionState;
    if (state === 'failed' || state === 'disconnected') {
      onFailed?.(state);
    }
  });

  return peer;
}

export function sendFiles({ peer, files, onProgress, onDone, onCancel, onError }) {
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  let sentTotal = 0;
  let cancelled = false;

  const dataHandler = (data) => {
    if (typeof data === 'string') {
      const msg = JSON.parse(data);
      if (msg.type === 'cancel') {
        cancelled = true;
        onCancel?.();
      }
    }
  };
  peer.on('data', dataHandler);

  const waitForConnect = () =>
    new Promise((resolve) => {
      if (peer.connected) return resolve();
      peer.once('connect', resolve);
    });

  (async () => {
    try {
      await waitForConnect();

      for (const f of files) {
        if (cancelled) break;
        peer.send(JSON.stringify({ type: 'file-start', id: f.id, name: f.name, size: f.size }));

        const reader = f.file.stream().getReader();
        while (true) {
          if (cancelled) break;
          const { done, value } = await reader.read();
          if (done) break;
          for (let o = 0; o < value.byteLength; o += CHUNK_SIZE) {
            if (cancelled) break;
            const slice = value.subarray(o, o + CHUNK_SIZE);
            peer.send(slice);
            sentTotal += slice.byteLength;
            onProgress?.(Math.min(sentTotal / totalSize, 1));
            while (peer._channel && peer._channel.bufferedAmount > BACKPRESSURE_LIMIT) {
              await new Promise((r) => setTimeout(r, 50));
            }
          }
        }
        if (!cancelled) peer.send(JSON.stringify({ type: 'file-end', id: f.id }));
      }
      if (!cancelled) {
        peer.send(JSON.stringify({ type: 'transfer-complete' }));
        onDone?.();
      }
    } catch (err) {
      onError?.(err);
    } finally {
      peer.off('data', dataHandler);
    }
  })();
}

export function receiveFiles({ peer, mode, fileHandles, onProgress, onDone, onError }) {
  let writer = null;
  let currentMeta = null;
  let received = 0;
  let totalExpected = 0;
  const zipParts = [];

  peer.on('data', async (data) => {
    if (typeof data === 'string') {
      const msg = JSON.parse(data);

      if (msg.type === 'file-start') {
        currentMeta = msg;
        totalExpected += msg.size;

        const handle = fileHandles?.get(msg.id);
        if (mode === 'individual' && handle) {
          writer = await handle.createWritable();
        } else {
          writer = { chunks: [] };
        }
        return;
      }

      if (msg.type === 'file-end') {
        if (mode === 'individual' && writer?.close) {
          await writer.close();
        } else if (mode === 'individual') {
          triggerDownload(new Blob(writer.chunks), currentMeta.name);
        } else if (mode === 'zip') {
          zipParts.push({ name: currentMeta.name, blob: new Blob(writer.chunks) });
        }
        writer = null;
        return;
      }

      if (msg.type === 'transfer-complete') {
        if (mode === 'zip') {
          const JSZip = (await import('jszip')).default;
          const zip = new JSZip();
          zipParts.forEach((p) => zip.file(p.name, p.blob));
          const blob = await zip.generateAsync({ type: 'blob' });
          triggerDownload(blob, 'download.zip');
        }
        onDone?.();
      }
      return;
    }

    received += data.byteLength;
    onProgress?.(totalExpected ? Math.min(received / totalExpected, 1) : 0);
    if (writer?.write) await writer.write(data);
    else if (writer?.chunks) writer.chunks.push(data);
  });

  peer.on('close', async () => {
    if (writer?.abort) await writer.abort();
    onError?.('connection-lost');
  });
  peer.on('error', () => onError?.('connection-error'));
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function cancelTransfer(peer) {
  try {
    peer.send(JSON.stringify({ type: 'cancel' }));
  } catch { }
}