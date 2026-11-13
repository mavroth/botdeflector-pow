import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileFill } from '../src/pow/digest.js';
import {
  buildGraph,
  buildGraphParallel,
  edgeEndpoints,
  issueSession,
  solveSync,
  stopWorkers,
  verifySolution,
} from '../src/index.js';

const fixture = JSON.parse(readFileSync(new URL('./vector.json', import.meta.url), 'utf8'));

after(async () => {
  await stopWorkers();
});

function specGraph(nodesBits, edgesBits, seed) {
  const numNodes = 1 << nodesBits;
  const numEdges = 1 << edgesBits;
  const mask = numNodes - 1;
  const buf = Buffer.from(seed);
  const head = Buffer.alloc(4);
  const us = new Int32Array(numEdges);
  const vs = new Int32Array(numEdges);
  const degree = new Int32Array(numNodes);
  for (let e = 0; e < numEdges; e++) {
    head.writeUInt32LE(e, 0);
    const digest = createHash('sha256').update(head).update(buf).digest();
    const u = digest.readUInt32LE(0) & mask;
    const v = digest.readUInt32LE(8) & mask;
    us[e] = u;
    vs[e] = v;
    degree[u]++;
    degree[v]++;
  }
  const offsets = new Int32Array(numNodes + 1);
  for (let i = 0; i < numNodes; i++) offsets[i + 1] = offsets[i] + degree[i];
  const neighbors = new Int32Array(numEdges * 2);
  const edgeIndices = new Int32Array(numEdges * 2);
  const cursor = offsets.slice(0, numNodes);
  for (let e = 0; e < numEdges; e++) {
    const u = us[e];
    const v = vs[e];
    let p = cursor[u]++;
    neighbors[p] = v;
    edgeIndices[p] = e;
    p = cursor[v]++;
    neighbors[p] = u;
    edgeIndices[p] = e;
  }
  return { nodes: numNodes, offsets, neighbors, edgeIndices };
}

function specCycle(graph, cycleLength, startOffset) {
  const { offsets, neighbors, edgeIndices, nodes } = graph;
  const onPath = new Uint8Array(nodes);
  const dfs = (start) => {
    onPath[start] = 1;
    const edgePath = [];
    const stack = [[start, -1, -1, 0, offsets[start], offsets[start + 1]]];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const pos = top[4];
      if (pos >= top[5]) {
        onPath[top[0]] = 0;
        if (top[2] !== -1) edgePath.pop();
        stack.pop();
        continue;
      }
      top[4] = pos + 1;
      const nb = neighbors[pos];
      const eidx = edgeIndices[pos];
      if (nb === top[1]) continue;
      const depth = top[3];
      if (onPath[nb]) {
        if (nb === start && depth + 1 === cycleLength) {
          edgePath.push(eidx);
          return edgePath.slice();
        }
      } else if (depth + 1 < cycleLength) {
        onPath[nb] = 1;
        edgePath.push(eidx);
        stack.push([nb, top[0], eidx, depth + 1, offsets[nb], offsets[nb + 1]]);
      }
    }
    return null;
  };
  for (let k = 0; k < nodes; k++) {
    const found = dfs((startOffset + k) % nodes);
    if (found) return found;
  }
  return null;
}

describe('edge hash', () => {
  it('matches sha256 for every edge of a short seed', () => {
    const seed = 'pow-digest-check';
    const numEdges = 1 << 12;
    const mask = (1 << 10) - 1;
    const us = new Int32Array(numEdges);
    const vs = new Int32Array(numEdges);
    compileFill(seed)(0, numEdges, mask, us, vs);
    for (let e = 0; e < numEdges; e++) {
      const [u, v] = edgeEndpoints(e, 1 << 10, seed);
      assert.equal(us[e], u, `u at ${e}`);
      assert.equal(vs[e], v, `v at ${e}`);
    }
  });

  it('matches sha256 when the seed needs more than one block', () => {
    const seed = 's'.repeat(80);
    const numEdges = 1 << 8;
    const mask = (1 << 8) - 1;
    const us = new Int32Array(numEdges);
    const vs = new Int32Array(numEdges);
    compileFill(seed)(0, numEdges, mask, us, vs);
    for (let e = 0; e < numEdges; e++) {
      const [u, v] = edgeEndpoints(e, 1 << 8, seed);
      assert.equal(us[e], u);
      assert.equal(vs[e], v);
    }
  });
});

describe('vector', () => {
  it('reproduces the checked edge indices', () => {
    const { solution } = solveSync(fixture);
    assert.equal(solution.length, fixture.expected.length);
    for (let i = 0; i < solution.length; i++) {
      assert.equal(solution[i].challenge, fixture.expected[i].challenge);
      assert.deepEqual(solution[i].edgeIndices, fixture.expected[i].edgeIndices);
    }
  });

  it('reuses one graph for a second solve', () => {
    const first = solveSync(fixture);
    const second = solveSync(fixture, first.graph);
    assert.deepEqual(second.solution, first.solution);
  });
});

describe('session', () => {
  it('issues a session that verifies, and rejects a flipped edge', () => {
    const payload = issueSession({
      nodesBits: 8,
      edgesBits: 11,
      cycleLength: 6,
      count: 2,
      sessionId: 'session-a',
    });
    const { solution, graph } = solveSync(payload);
    assert.deepEqual(verifySolution(payload, { solution }, graph), { ok: true });
    const tampered = structuredClone(solution);
    tampered[0].edgeIndices[0] ^= 1;
    const failed = verifySolution(payload, { solution: tampered }, graph);
    assert.equal(failed.ok, false);
    assert.equal(failed.reason, 'edges');
  });

  it('uses sessionId as the seed, unless GRAPH_SEED is set', () => {
    const challenges = [Buffer.alloc(32, 7).toString('hex')];
    const params = { NODES_BITS: 8, EDGES_BITS: 10, CYCLE_LENGTH: 5 };
    const fromSession = solveSync({ challenges, params, sessionId: 'seed-a' });
    const explicit = solveSync({
      challenges,
      params: { ...params, GRAPH_SEED: 'seed-a' },
      sessionId: 'other',
    });
    const other = solveSync({ challenges, params, sessionId: 'seed-b' });
    assert.deepEqual(explicit.solution, fromSession.solution);
    assert.notDeepEqual(other.solution, fromSession.solution);
  });

  it('rejects a challenge that is not hex', () => {
    const payload = issueSession({ nodesBits: 6, edgesBits: 8, count: 1, sessionId: 'z' });
    payload.challenges[0] = 'zz';
    assert.throws(() => solveSync(payload), /hex/);
  });

  it('throws when no cycle of the requested length exists', () => {
    const payload = issueSession({
      nodesBits: 4,
      edgesBits: 4,
      cycleLength: 32,
      count: 1,
      sessionId: 'tiny',
    });
    assert.throws(() => solveSync(payload), /no cycle/);
  });

  it('solves an empty challenge list', () => {
    const { solution } = solveSync({
      challenges: [],
      params: { NODES_BITS: 6, EDGES_BITS: 8, CYCLE_LENGTH: 4, GRAPH_SEED: 'empty' },
    });
    assert.deepEqual(solution, []);
  });
});

describe('agreement with an independent walk', () => {
  it('matches CSR order and the first cycle on a small random session', () => {
    const payload = issueSession({
      nodesBits: 8,
      edgesBits: 12,
      cycleLength: 6,
      count: 3,
      sessionId: 'compare-me',
    });
    const ours = solveSync(payload);
    const graph = specGraph(8, 12, payload.sessionId);
    assert.deepEqual(Array.from(ours.graph.neighbors), Array.from(graph.neighbors));
    assert.deepEqual(Array.from(ours.graph.edgeIndices), Array.from(graph.edgeIndices));
    for (const item of ours.solution) {
      assert.deepEqual(item.edgeIndices, specCycle(graph, 6, startIndex(item.challenge, graph.nodes)));
    }
  });
});

function startIndex(challenge, numNodes) {
  const digest = createHash('sha256').update(Buffer.from(challenge, 'hex')).digest();
  return digest.readUInt32LE(0) & (numNodes - 1);
}

describe('parallel build', () => {
  it('produces the same CSR as the single-threaded build', async () => {
    const params = { NODES_BITS: 10, EDGES_BITS: 14, CYCLE_LENGTH: 6, GRAPH_SEED: 'parallel-seed' };
    const sync = buildGraph(params);
    const parallel = await buildGraphParallel(params, { workers: 4 });
    assert.deepEqual(Array.from(parallel.neighbors), Array.from(sync.neighbors));
    assert.deepEqual(Array.from(parallel.edgeIndices), Array.from(sync.edgeIndices));
    const payload = {
      challenges: [Buffer.alloc(32, 3).toString('hex'), Buffer.alloc(32, 9).toString('hex')],
      params,
    };
    assert.deepEqual(solveSync(payload, parallel).solution, solveSync(payload, sync).solution);
  });
});

describe('cli', () => {
  it('prints the verify body for the vector', () => {
    const result = spawnSync(process.execPath, ['bin/solve.js', 'test/vector.json'], {
      encoding: 'utf8',
      cwd: fileURLToPath(new URL('..', import.meta.url)),
    });
    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.deepEqual(body.solution[0].edgeIndices, fixture.expected[0].edgeIndices);
    assert.match(result.stderr, /solved 3 challenges/);
  });
});
