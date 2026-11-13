#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { finishGraph } from '../src/pow/graph.js';
import { solve, stopWorkers } from '../src/index.js';

function msSince(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function minOf(values) {
  return Math.min(...values);
}

/** Full graph build with one node:crypto SHA-256 per edge. Baseline only. */
function cryptoBuild(params) {
  const numNodes = 1 << params.NODES_BITS;
  const numEdges = 1 << params.EDGES_BITS;
  const seed = Buffer.from(params.GRAPH_SEED ?? '', 'utf8');
  const mask = numNodes - 1;
  const head = Buffer.alloc(4);
  const us = new Int32Array(numEdges);
  const vs = new Int32Array(numEdges);
  for (let e = 0; e < numEdges; e++) {
    head.writeUInt32LE(e, 0);
    const digest = createHash('sha256').update(head).update(seed).digest();
    us[e] = digest.readUInt32LE(0) & mask;
    vs[e] = digest.readUInt32LE(8) & mask;
  }
  return finishGraph(us, vs, numNodes, numEdges, seed.toString());
}

const fixture = JSON.parse(readFileSync(new URL('../test/vector.json', import.meta.url), 'utf8'));
const heavy = process.argv.includes('--heavy');

if (!heavy) {
  cryptoBuild(fixture.params);
  const baseline = [];
  for (let i = 0; i < 3; i++) {
    const t = process.hrtime.bigint();
    cryptoBuild(fixture.params);
    baseline.push(msSince(t));
  }
  const cold = await solve(fixture, { parallel: false });
  const builds = [];
  const searches = [];
  const totals = [];
  for (let i = 0; i < 5; i++) {
    const t = process.hrtime.bigint();
    const result = await solve(fixture, { parallel: false });
    totals.push(msSince(t));
    builds.push(result.timings.buildMs);
    searches.push(result.timings.searchMs);
  }
  const pad = (n) => n.toFixed(1).padStart(8);
  console.log('fixture  NODES_BITS=14 EDGES_BITS=16 CYCLE_LENGTH=8  3 challenges');
  console.log(`createHash graph build   ${pad(minOf(baseline))} ms`);
  console.log(`this build, cold          ${pad(cold.timings.buildMs)} ms`);
  console.log(`this build, warm          ${pad(minOf(builds))} ms`);
  console.log(`cycle search              ${pad(minOf(searches))} ms`);
  console.log(`warm total                ${pad(minOf(totals))} ms`);
} else {
  const payload = {
    sessionId: 'heavy-bench-seed',
    challenges: ['11', '22', '33', '44'].map((byte) => byte.repeat(32)),
    params: { NODES_BITS: 18, EDGES_BITS: 20, CYCLE_LENGTH: 7 },
  };
  console.log('heavy    NODES_BITS=18 EDGES_BITS=20 CYCLE_LENGTH=7  4 challenges');
  try {
    const sync = await solve(payload, { parallel: false });
    const cold = await solve(payload, { parallel: true });
    const warm = await solve(payload, { parallel: true });
    const pad = (n) => n.toFixed(1).padStart(8);
    console.log(`sync build                ${pad(sync.timings.buildMs)} ms`);
    console.log(`parallel build, cold      ${pad(cold.timings.buildMs)} ms`);
    console.log(`parallel build, warm      ${pad(warm.timings.buildMs)} ms`);
    console.log(`cycle search              ${pad(warm.timings.searchMs)} ms`);
  } finally {
    await stopWorkers();
  }
}
