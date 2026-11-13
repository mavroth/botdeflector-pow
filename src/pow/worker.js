import { parentPort } from 'node:worker_threads';
import { compileFill } from './digest.js';

if (!parentPort) throw new Error('worker entry');

parentPort.on('message', (msg) => {
  try {
    if (msg.type !== 'fill') throw new Error(`unknown worker message ${msg.type}`);
    const us = new Int32Array(msg.us);
    const vs = new Int32Array(msg.vs);
    if (msg.end > us.length || msg.start < 0 || msg.end < msg.start) {
      throw new RangeError('edge range is outside the shared buffers');
    }
    compileFill(msg.seed)(msg.start, msg.end, msg.mask, us, vs);
    parentPort.postMessage({ id: msg.id });
  } catch (err) {
    parentPort.postMessage({ id: msg.id, error: err && err.stack ? err.stack : String(err) });
  }
});
