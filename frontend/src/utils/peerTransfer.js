import SimplePeer from 'simple-peer';

const CHUNK_SIZE = 16 * 1024;
const BACKPRESSURE_LIMIT = 1 * 1024 * 1024; // lowered from 4MB — large buffers were likely overwhelming the channel

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
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

  peer.on('connect', () => {
    console.log('[RAW] channel readyState:', peer._channel?.readyState);
    peer._channel?.addEventListener('message', (e) => {
      console.log('[RAW CHANNEL MESSAGE]', typeof e.data, e.data instanceof ArrayBuffer ? e.data.byteLength : e.data);
    });
    peer._pc.getStats(null).then((stats) => {
      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          const local = stats.get(report.localCandidateId);
          const remote = stats.get(report.remoteCandidateId);
          console.log('[ICE candidate pair]', {
            local: local?.candidateType,
            remote: remote?.candidateType,
            protocol: local?.protocol,
          });
        }
      });
    });
  });

  let disconnectTimer = null;

  peer._pc?.addEventListener?.('iceconnectionstatechange', () => {
    const state = peer._pc.iceConnectionState;

    if (state === 'connected' || state === 'completed') {
      if (disconnectTimer) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
      }
      return;
    }

    if (state === 'failed') {
      if (disconnectTimer) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
      }
      onFailed?.(state);
      return;
    }

    if (state === 'disconnected') {
      if (disconnectTimer) clearTimeout(disconnectTimer);
      disconnectTimer = setTimeout(() => {
        const current = peer._pc?.iceConnectionState;
        if (current === 'disconnected' || current === 'failed') {
          onFailed?.(current);
        }
      }, 5000);
    }
  });

  return peer;
}

export function sendFiles({ peer, files, onProgress, onDone, onCancel, onError }) {
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  let sentTotal = 0;
  let cancelled = false;

  console.log('[sendFiles] starting', { fileCount: files.length, totalSize, peerConnected: peer.connected });

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
      if (peer.connected) {
        console.log('[sendFiles] peer already connected');
        return resolve();
      }
      console.log('[sendFiles] waiting for peer to connect...');
      peer.once('connect', () => {
        console.log('[sendFiles] peer connected event fired');
        resolve();
      });
    });

  (async () => {
    try {
      await waitForConnect();

      for (const f of files) {
        if (cancelled) break;
        console.log('[sendFiles] starting file', f.name, f.size);
        peer.send(JSON.stringify({ type: 'file-start', id: f.id, name: f.name, size: f.size }));

        const reader = f.file.stream().getReader();
        let chunkCount = 0;
        while (true) {
          if (cancelled) break;
          const { done, value } = await reader.read();
          if (done) break;
          for (let o = 0; o < value.byteLength; o += CHUNK_SIZE) {
            if (cancelled) break;

            // Wait for buffer to drain BEFORE sending, not just after —
            // sending while already over the limit can pile up faster
            // than the channel drains, especially on slower/lossy links.
            while (peer._channel && peer._channel.bufferedAmount > BACKPRESSURE_LIMIT) {
              await new Promise((r) => setTimeout(r, 50));
            }

            const slice = value.slice(o, o + CHUNK_SIZE); // .slice() copies, .subarray() was a view — copy is safer across async boundaries
            peer.send(slice);
            sentTotal += slice.byteLength;
            chunkCount++;
            onProgress?.(Math.min(sentTotal / totalSize, 1));
          }
        }
        console.log('[sendFiles] finished file', f.name, 'chunks sent:', chunkCount);
        if (!cancelled) peer.send(JSON.stringify({ type: 'file-end', id: f.id }));
      }
      if (!cancelled) {
        peer.send(JSON.stringify({ type: 'transfer-complete' }));

        // Wait until the data channel has ACTUALLY flushed everything —
        // not just queued it — before telling the UI "done". Otherwise
        // closing/navigating right after can drop still-buffered bytes,
        // silently corrupting the file on the receiver's end.
        while (peer._channel && peer._channel.bufferedAmount > 0) {
          await new Promise((r) => setTimeout(r, 50));
        }

        console.log('[sendFiles] fully flushed, total bytes:', sentTotal);
        onDone?.();
      }
    } catch (err) {
      console.error('[sendFiles] error', err);
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

  console.log('[receiveFiles] listening, peer connected:', peer.connected);

  let writeQueue = Promise.resolve();
  const enqueue = (task) => {
    writeQueue = writeQueue.then(task).catch((err) => {
      console.error('[receiveFiles] write error', err);
      onError?.('write-error');
      throw err;
    });
    return writeQueue;
  };

  peer.on('data', (data) => {
    enqueue(async () => {
      if (typeof data === 'string') {
        const msg = JSON.parse(data);
        console.log('[receiveFiles] control message', msg.type);

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
          console.log('[receiveFiles] transfer-complete received, total bytes:', received);
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
  });

  peer.on('close', () => {
    console.log('[receiveFiles] peer closed, bytes received so far:', received);
    enqueue(async () => {
      if (writer?.abort) await writer.abort();
      onError?.('connection-lost');
    });
  });
  peer.on('error', (err) => {
    console.error('[receiveFiles] peer error', err);
    onError?.('connection-error');
  });
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