// peerTransfer.js
import SimplePeer from 'simple-peer';
import toast from 'react-hot-toast';
import { createElement } from 'react';

const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const CHUNK_SIZE = 64 * 1024;
const BACKPRESSURE_LIMIT = 2 * 1024 * 1024;

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

// ──── Module-level receive listener tracking ────
// Allows cleanup between successive receiveFiles() calls on the same peer
// (e.g. 2nd/3rd batch) without listener stacking, which was the root cause
// of doubled toasts and corrupted downloads.
let _recvHandler = null;
let _recvChannel = null;
let _recvPendingConnect = null;

/**
 * Remove the active receive channel listener (if any). Called at the start
 * of each receiveFiles() and from JoinRoom's peer 'close' handler.
 */
export function cleanupReceiveListener() {
  if (_recvHandler && _recvChannel) {
    try { _recvChannel.removeEventListener('message', _recvHandler); } catch {}
  }
  _recvHandler = null;
  _recvChannel = null;
}

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
      if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
      return;
    }

    if (state === 'failed') {
      if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
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
    } else {
      peer.once('connect', attachChannelListener);
    }
  };

  if (peer._channel) {
    attachChannelListener();
  } else {
    peer.once('connect', attachChannelListener);
  }

  const waitForConnect = () =>
    new Promise((resolve) => {
      if (peer.connected) return resolve();
      peer.once('connect', () => resolve());
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

            while (peer._channel && peer._channel.bufferedAmount > BACKPRESSURE_LIMIT) {
              await new Promise((r) => setTimeout(r, 50));
            }

            const slice = value.slice(o, o + CHUNK_SIZE);
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
  // ──── Clean up any previous listener from a prior batch ────
  // This is THE fix for the 2nd/3rd batch bug. Previously, each call
  // to receiveFiles added a NEW listener to the same channel without
  // removing the old one — so every chunk was processed N times (N =
  // batch number), causing doubled toasts, corrupted files, and
  // eventually a frozen download.
  cleanupReceiveListener();

  // Also clean up any pending connect handler from a previous call
  if (_recvPendingConnect) {
    try { peer.off('connect', _recvPendingConnect); } catch {}
    _recvPendingConnect = null;
  }

  let writer = null;
  let currentMeta = null;
  let received = 0;
  let totalExpected = 0;
  let completed = false;
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

  const channelMessageHandler = (event) => {
    const data = event.data;
    // Guard: if this handler has been superseded by a new receiveFiles
    // call, ignore the message. (Shouldn't happen since we remove the
    // listener above, but this is a safety net.)
    if (_recvHandler !== channelMessageHandler) return;

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

      // Binary chunk
      received += data.byteLength;
      onProgress?.(totalExpected ? Math.min(received / totalExpected, 1) : 0);
      if (writer?.write) await writer.write(data);
      else if (writer?.chunks) writer.chunks.push(data);
    });
  };

  // Store at module level so cleanupReceiveListener() can remove it
  _recvHandler = channelMessageHandler;

  const attachChannelListener = () => {
    if (peer._channel) {
      _recvChannel = peer._channel;
      peer._channel.addEventListener('message', channelMessageHandler);
    } else {
      console.warn('[receiveFiles] peer._channel not available yet, will attach on connect');
      _recvPendingConnect = () => {
        _recvPendingConnect = null;
        _recvChannel = peer._channel;
        peer._channel?.addEventListener('message', channelMessageHandler);
      };
      peer.once('connect', _recvPendingConnect);
    }
  };

  attachChannelListener();

  // ──── NO peer.on('close') or peer.on('error') here ────
  // The caller (JoinRoom) handles those events and calls
  // cleanupReceiveListener() when appropriate. Having them here caused
  // stacking when receiveFiles was called multiple times on the same
  // peer — each call added ANOTHER close/error handler.
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
    doDownload();
    // FIX: Don't revoke immediately — the browser needs the URL to be
    // valid when it actually reads the blob data for the download.
    // Revoking too fast could truncate the file on slower systems.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return;
  }

  // Mobile: show toast with tappable Save button (trusted user gesture)
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
  } catch {}
}