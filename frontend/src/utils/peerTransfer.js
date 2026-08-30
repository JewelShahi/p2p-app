// peerTransfer.js
import SimplePeer from 'simple-peer';
import toast from 'react-hot-toast';
import { createElement } from 'react';

const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// FIX (corruption): 16KB is the safe max message size across ALL browsers,
// including mobile Safari/Chrome. 64KB can be silently dropped/split on some
// mobile WebRTC stacks — a prime cause of "corrupted" files.
const CHUNK_SIZE = 16 * 1024;
const BACKPRESSURE_LIMIT = 1 * 1024 * 1024; // pause sending above 1MB buffered

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
let _recvHandler = null;
let _recvChannel = null;
let _recvPendingConnect = null;

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
      // FIX (mobile): give a backgrounded phone longer to come back before
      // we declare the peer dead. 5s was too short for a gallery round-trip.
      if (disconnectTimer) clearTimeout(disconnectTimer);
      disconnectTimer = setTimeout(() => {
        const current = peer._pc?.iceConnectionState;
        if (current === 'disconnected' || current === 'failed') {
          onFailed?.(current);
        }
      }, 15000);
    }
  });

  return peer;
}

export function sendFiles({ peer, files, onProgress, onDone, onCancel, onError }) {
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  let sentTotal = 0;
  let cancelled = false;

  const channelMessageHandler = (event) => {
    const data = event.data;
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'cancel') {
          cancelled = true;
          onCancel?.();
        }
      } catch {}
    }
  };

  const attachChannelListener = () => {
    if (peer._channel) {
      peer._channel.addEventListener('message', channelMessageHandler);
    } else {
      peer.once('connect', attachChannelListener);
    }
  };
  attachChannelListener();

  const waitForConnect = () =>
    new Promise((resolve) => {
      if (peer.connected) return resolve();
      peer.once('connect', () => resolve());
    });

  const waitForDrain = () =>
    new Promise((resolve) => {
      const check = () => {
        if (!peer._channel || peer._channel.bufferedAmount <= BACKPRESSURE_LIMIT) return resolve();
        setTimeout(check, 40);
      };
      check();
    });

  (async () => {
    try {
      await waitForConnect();

      for (const f of files) {
        if (cancelled) break;

        // Announce file with its exact size so the receiver can verify it.
        peer.send(JSON.stringify({ type: 'file-start', id: f.id, name: f.name, size: f.size }));

        const reader = f.file.stream().getReader();
        while (true) {
          if (cancelled) break;
          const { done, value } = await reader.read();
          if (done) break;

          for (let o = 0; o < value.byteLength; o += CHUNK_SIZE) {
            if (cancelled) break;
            await waitForDrain();
            const slice = value.slice(o, o + CHUNK_SIZE);
            peer.send(slice);
            sentTotal += slice.byteLength;
            onProgress?.(Math.min(sentTotal / totalSize, 1));
          }
        }

        // file-end carries the byte size so the receiver can do a per-file check.
        if (!cancelled) peer.send(JSON.stringify({ type: 'file-end', id: f.id, size: f.size }));
      }

      if (!cancelled) {
        // transfer-complete carries the grand total for a final integrity check.
        peer.send(JSON.stringify({ type: 'transfer-complete', totalSize }));
        // Flush the channel fully before we resolve, so nothing is lost.
        while (peer._channel && peer._channel.bufferedAmount > 0) {
          await new Promise((r) => setTimeout(r, 40));
        }
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
  cleanupReceiveListener();
  if (_recvPendingConnect) {
    try { peer.off('connect', _recvPendingConnect); } catch {}
    _recvPendingConnect = null;
  }

  let writer = null;
  let currentMeta = null;
  let received = 0;         // total bytes across all files
  let fileReceived = 0;     // bytes for the current file (integrity)
  let totalExpected = 0;    // sum of announced file sizes
  let completed = false;
  const zipParts = [];

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
    if (_recvHandler !== channelMessageHandler) return;

    enqueue(async () => {
      if (typeof data === 'string') {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }

        if (msg.type === 'file-start') {
          currentMeta = msg;
          fileReceived = 0;
          totalExpected += msg.size || 0;
          const handle = fileHandles?.get(msg.id);
          if (mode === 'individual' && handle) {
            writer = await handle.createWritable();
          } else {
            writer = { chunks: [] };
          }
          return;
        }

        if (msg.type === 'file-end') {
          // ── PER-FILE INTEGRITY CHECK ──
          const expected = msg.size ?? currentMeta?.size ?? 0;
          if (expected && fileReceived !== expected) {
            console.error('[receiveFiles] size mismatch', currentMeta?.name, fileReceived, 'vs', expected);
            try { if (writer?.abort) await writer.abort(); } catch {}
            writer = null;
            // Refuse to deliver a truncated/corrupt file.
            onError?.('incomplete-file');
            return;
          }

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
          // ── FINAL INTEGRITY CHECK ──
          if (msg.totalSize != null && received !== msg.totalSize) {
            console.error('[receiveFiles] total mismatch', received, 'vs', msg.totalSize);
            onError?.('incomplete-transfer');
            return;
          }

          completed = true;
          if (mode === 'zip') {
            const JSZip = (await import('jszip')).default;
            const zip = new JSZip();
            zipParts.forEach((p) => zip.file(p.name, p.blob));
            // STORE (level 0): files are already compressed formats most of the
            // time; this is far faster and avoids OOM on mobile for big batches.
            const blob = await zip.generateAsync({
              type: 'blob',
              compression: 'STORE',
            });
            triggerDownload(blob, (currentMeta?.batchName || 'files') + '.zip');
          }
          onDone?.();
        }
        return;
      }

      // Binary chunk
      const len = data.byteLength ?? data.size ?? 0;
      received += len;
      fileReceived += len;
      onProgress?.(totalExpected ? Math.min(received / totalExpected, 1) : 0);
      if (writer?.write) await writer.write(data);
      else if (writer?.chunks) writer.chunks.push(data);
    });
  };

  _recvHandler = channelMessageHandler;

  const attachChannelListener = () => {
    if (peer._channel) {
      _recvChannel = peer._channel;
      peer._channel.addEventListener('message', channelMessageHandler);
    } else {
      _recvPendingConnect = () => {
        _recvPendingConnect = null;
        _recvChannel = peer._channel;
        peer._channel?.addEventListener('message', channelMessageHandler);
      };
      peer.once('connect', _recvPendingConnect);
    }
  };
  attachChannelListener();

  // Expose whether the transfer truly completed, so callers don't mark a
  // truncated download as "done" on an unexpected channel close.
  return { isComplete: () => completed };
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
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return;
  }

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
