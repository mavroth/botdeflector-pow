import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { buildGraph, finishGraph } from './graph.js';
import { normalizeParams } from './params.js';

const pending = new Map();
const pool = [];
let nextId = 1;

function attach(worker) {
  worker.on('message', (msg) => {
    const job = pending.get(msg.id);
    if (!job) return;
    pending.delete(msg.id);
    if (msg.error) job.reject(new Error(msg.error));
    else job.resolve(msg);
  });
  worker.on('error', (err) => {
    for (const [id, job] of pending) {
      if (job.worker === worker) {
        pending.delete(id);
        job.reject(err);
      }
    }
  });
}

function getPool(count) {
  while (pool.length < count) {
    const worker = new Worker(new URL('./worker.js', import.meta.url));
    worker.unref();
    attach(worker);
    pool.push(worker);
  }
  return pool.slice(0, count);
}

function call(worker, payload) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, worker });
    worker.postMessage({ ...payload, id });
  });
}

export async function stopWorkers() {
  const running = pool.splice(0, pool.length);
  await Promise.all(running.map((worker) => worker.terminate()));
}

/**
 * Build the same CSR graph as `buildGraph`, hashing edge shards on a worker pool.
 * Worth it once the edge count is large; the caller decides.
 */
export async function buildGraphParallel(params, options = {}) {
  const norm = params && params.seed !== undefined && params.nodesBits !== undefined
    ? params
    : normalizeParams(params);
  const numNodes = 1 << norm.nodesBits;
  const numEdges = 1 << norm.edgesBits;
  const requested = options.workers ?? os.availableParallelism();
  if (!Number.isInteger(requested) || requested < 1) {
    throw new RangeError('workers must be a positive integer');
  }
  const useful = Math.max(1, Math.floor(numEdges / 4096));
  const workers = Math.min(requested, useful, numEdges);
  if (workers === 1) return buildGraph(norm);

  const us = new Int32Array(new SharedArrayBuffer(numEdges * 4));
  const vs = new Int32Array(new SharedArrayBuffer(numEdges * 4));
  const chunk = Math.ceil(numEdges / workers);
  const jobs = [];
  const poolNow = getPool(workers);
  for (let i = 0; i < workers; i++) {
    const start = i * chunk;
    if (start >= numEdges) break;
    const end = Math.min(numEdges, start + chunk);
    jobs.push(call(poolNow[i], {
      type: 'fill',
      seed: norm.seed,
      start,
      end,
      mask: numNodes - 1,
      us: us.buffer,
      vs: vs.buffer,
    }));
  }
  await Promise.all(jobs);
  return finishGraph(us, vs, numNodes, numEdges, norm.seed);
}
