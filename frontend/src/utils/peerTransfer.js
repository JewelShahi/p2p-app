import SimplePeer from 'simple-peer';
import toast from 'react-hot-toast';
import { createElement } from 'react';

const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const CHUNK_SIZE = 64 * 1024; // raised from 16KB now that we listen on the native channel directly and know delivery is reliable — improves throughput
const BACKPRESSURE_LIMIT = 2 * 1024 * 1024; // raised from 1MB — the write-queue serialization + pre-send backpressure check already prevent corruption regardless of chunk size, so this is safe to raise for speed

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

  // NOTE: switched from peer.on('data', ...) to listening directly on the
  // native RTCDataChannel. We proved via diagnostic logging that the native
  // channel reliably delivers every message, but simple-peer's own 'data'
  // event was NOT firing on the receiver side for this app/version — so we
  // bypass simple-peer's wrapper for receiving and read the channel directly.
  const channelMessageHandler = (event) => {
    const data = event.data;
    if (typeof data === 'string') {
      const msg = JSON.parse(data);
      if (msg.type === 'cancel') {
        cancelled = true;
        onCancel?.();
      }
    }
  };

  const attachChannelListener = () => {
    if (peer._channel) {
      peer._channel.addEventListener('message', channelMessageHandler);
    }
  };

  if (peer._channel) {
    attachChannelListener();
  } else {
    peer.once('connect', attachChannelListener);
  }

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
      if (peer._channel) {
        peer._channel.removeEventListener('message', channelMessageHandler);
      }
    }
  })();
}

export function receiveFiles({ peer, mode, fileHandles, onProgress, onDone, onError }) {
  let writer = null;
  let currentMeta = null;
  let received = 0;
  let totalExpected = 0;
  let completed = false; // set once transfer-complete has actually been processed
  const zipParts = [];

  console.log('[receiveFiles] listening, peer connected:', peer.connected, 'channel exists:', !!peer._channel);

  let writeQueue = Promise.resolve();
  const enqueue = (task) => {
    writeQueue = writeQueue.then(task).catch((err) => {
      console.error('[receiveFiles] write error', err);
      onError?.('write-error');
      throw err;
    });
    return writeQueue;
  };

  // NOTE: switched from peer.on('data', ...) to listening directly on the
  // native RTCDataChannel (peer._channel). Diagnostic logging confirmed the
  // native channel reliably delivers every message (file-start, chunks,
  // file-end, transfer-complete, in order) but simple-peer's own 'data'
  // event never fired here — so we read the channel directly instead of
  // going through simple-peer's wrapper.
  const channelMessageHandler = (event) => {
    const data = event.data;
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
          completed = true;
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

      // Binary chunk. Native RTCDataChannel messages arrive as ArrayBuffer
      // (not the Buffer/Uint8Array shim simple-peer normally hands you), but
      // .byteLength works the same and both handle.write() and Blob parts
      // accept ArrayBuffer directly, so nothing downstream needs to change.
      received += data.byteLength;
      onProgress?.(totalExpected ? Math.min(received / totalExpected, 1) : 0);
      if (writer?.write) await writer.write(data);
      else if (writer?.chunks) writer.chunks.push(data);
    });
  };

  const attachChannelListener = () => {
    if (peer._channel) {
      peer._channel.addEventListener('message', channelMessageHandler);
    } else {
      console.warn('[receiveFiles] peer._channel not available yet, will attach on connect');
      peer.once('connect', () => {
        peer._channel?.addEventListener('message', channelMessageHandler);
      });
    }
  };

  attachChannelListener();

  peer.on('close', () => {
    console.log('[receiveFiles] peer closed, bytes received so far:', received, 'completed:', completed);
    if (peer._channel) {
      peer._channel.removeEventListener('message', channelMessageHandler);
    }
    if (completed) return; // transfer already finished successfully — closing now is normal, not an error
    enqueue(async () => {
      if (writer?.abort) await writer.abort();
      onError?.('connection-lost');
    });
  });
  peer.on('error', (err) => {
    console.error('[receiveFiles] peer error', err);
    if (completed) return; // ignore late transport errors after a successful transfer
    onError?.('connection-error');
  });
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);

  const doDownload = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (!isMobile) {
    // Desktop browsers handle a programmatic click fine even outside a
    // direct user gesture — keep the original instant-download behavior.
    doDownload();
    URL.revokeObjectURL(url);
    return;
  }

  // On mobile (especially Android Chrome), clicking a download anchor from
  // inside an async callback has lost the "trusted user gesture" that
  // existed when the user originally tapped Accept. The browser then
  // silently accepts or blocks the download with no visible confirmation —
  // this is exactly the "says downloaded but nothing saved/no popup" bug.
  // Showing a toast with a real tappable button means the user's tap IS
  // the gesture, so the browser shows its normal download notification.
  const revokeTimer = setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);

  toast(
    (t) =>
      createElement(
        'div',
        { className: 'flex items-center gap-3' },
        createElement('span', null, `${name} is ready`),
        createElement(
          'button',
          {
            className: 'btn btn-sm btn-primary',
            onClick: () => {
              doDownload();
              toast.dismiss(t.id);
              clearTimeout(revokeTimer);
              setTimeout(() => URL.revokeObjectURL(url), 2000);
            },
          },
          'Save file'
        )
      ),
    { duration: 5 * 60 * 1000 }
  );
}

export function cancelTransfer(peer) {
  try {
    peer.send(JSON.stringify({ type: 'cancel' }));
  } catch { }
}