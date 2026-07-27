import net from 'net';

/**
 * Send an ESC/POS buffer to a LAN thermal printer over TCP port 9100.
 */
export function sendToEthernetPrinter({
  ipAddress,
  port = 9100,
  buffer,
  timeout = 8000,
} = {}) {
  return new Promise((resolve, reject) => {
    const host = String(ipAddress || '').trim();
    const targetPort = Number(port) || 9100;

    if (!host) {
      reject(new Error('Ethernet printer IP address is missing.'));
      return;
    }

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      reject(new Error('Ethernet print buffer is empty.'));
      return;
    }

    const socket = new net.Socket();
    let done = false;

    const finish = (error, result) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }

      if (error) reject(error);
      else resolve(result);
    };

    socket.setTimeout(timeout);

    socket.connect(targetPort, host, () => {
      socket.write(buffer, (writeErr) => {
        if (writeErr) {
          finish(new Error(`Ethernet printer write failed: ${writeErr.message}`));
          return;
        }
        socket.end();
        finish(null, {
          success: true,
          message: `Sent to Ethernet printer ${host}:${targetPort}`,
          ipAddress: host,
          port: targetPort,
        });
      });
    });

    socket.on('timeout', () => {
      finish(new Error(`Ethernet printer timeout: ${host}:${targetPort}`));
    });

    socket.on('error', (error) => {
      const code = error?.code || '';
      if (code === 'ECONNREFUSED') {
        finish(new Error(`Ethernet printer connection refused: ${host}:${targetPort}`));
        return;
      }
      if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
        finish(new Error(`Ethernet printer unreachable: ${host}:${targetPort}`));
        return;
      }
      if (code === 'ETIMEDOUT') {
        finish(new Error(`Ethernet printer timeout: ${host}:${targetPort}`));
        return;
      }
      finish(new Error(`Ethernet printer error: ${error.message || code || 'unknown'}`));
    });
  });
}

export default { sendToEthernetPrinter };
