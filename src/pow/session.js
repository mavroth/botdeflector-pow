import { randomBytes, randomUUID } from 'node:crypto';
import { computeStartIndex, findCycle } from './search.js';
import { buildGraph } from './graph.js';
import { buildGraphParallel } from './pool.js';
import { normalizeParams, paramsFromPayload } from './params.js';

function assertGraph(graph, norm) {
  if (!graph) return;
  if (graph.seed !== norm.seed) throw new Error('graph was built for a different seed');
  if (graph.nodes !== (1 << norm.nodesBits)) throw new Error('graph does not match NODES_BITS');
  if (graph.edges !== (1 << norm.edgesBits)) throw new Error('graph does not match EDGES_BITS');
}

export function solveChallenges(challenges, params, graph = null) {
  if (!Array.isArray(challenges)) throw new TypeError('challenges must be an array');
  const norm = params && params.seed !== undefined && params.nodesBits !== undefined
    ? params
    : normalizeParams(params);
  assertGraph(graph, norm);
  const g = graph || buildGraph(norm);
  const out = new Array(challenges.length);
  for (let i = 0; i < challenges.length; i++) {
    const challenge = challenges[i];
    const start = computeStartIndex(challenge, g.nodes);
    const edgeIndices = findCycle(g, norm.cycleLength, start);
    if (!edgeIndices) {
      throw new Error(`no cycle of length ${norm.cycleLength} found for challenge ${challenge}`);
    }
    out[i] = { challenge, edgeIndices };
  }
  return out;
}

export function solveSync(payload, graph = null) {
  const norm = paramsFromPayload(payload);
  const g = graph || buildGraph(norm);
  return { solution: solveChallenges(payload.challenges, norm, g), graph: g };
}

const PARALLEL_EDGES = 1 << 18;

/**
 * Solve a payload. Graphs at 2^18 edges and above use the worker pool unless
 * `options.parallel` is set. Pass `options.graph` to reuse a session graph.
 */
export async function solve(payload, options = {}) {
  const norm = paramsFromPayload(payload);
  const parallel = options.parallel ?? ((1 << norm.edgesBits) >= PARALLEL_EDGES);
  const t0 = process.hrtime.bigint();
  let graph = options.graph ?? null;
  if (graph) assertGraph(graph, norm);
  else graph = parallel ? await buildGraphParallel(norm, options) : buildGraph(norm);
  const t1 = process.hrtime.bigint();
  const solution = solveChallenges(payload.challenges, norm, graph);
  const t2 = process.hrtime.bigint();
  return {
    solution,
    graph,
    timings: {
      buildMs: Number(t1 - t0) / 1e6,
      searchMs: Number(t2 - t1) / 1e6,
      parallel: Boolean(parallel && !options.graph),
    },
  };
}

export function issueSession(options = {}) {
  const nodesBits = options.nodesBits ?? options.NODES_BITS ?? 14;
  const edgesBits = options.edgesBits ?? options.EDGES_BITS ?? 16;
  const cycleLength = options.cycleLength ?? options.CYCLE_LENGTH ?? 8;
  const count = options.count ?? 3;
  if (!Number.isInteger(count) || count < 1 || count > 256) {
    throw new RangeError('count must be an integer from 1 to 256');
  }
  const sessionId = options.sessionId ?? randomUUID();
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new TypeError('sessionId must be a non-empty string');
  }
  const challenges = new Array(count);
  for (let i = 0; i < count; i++) challenges[i] = randomBytes(32).toString('hex');
  const payload = {
    sessionId,
    challenges,
    params: {
      NODES_BITS: nodesBits,
      EDGES_BITS: edgesBits,
      CYCLE_LENGTH: cycleLength,
    },
  };
  normalizeParams({ ...payload.params, GRAPH_SEED: sessionId });
  return payload;
}

export function verifySolution(payload, submission, graph = null) {
  const { solution: expected } = solveSync(payload, graph);
  const got = Array.isArray(submission) ? submission : submission && submission.solution;
  if (!Array.isArray(got)) return { ok: false, reason: 'shape' };
  if (got.length !== expected.length) return { ok: false, reason: 'count' };
  for (let i = 0; i < expected.length; i++) {
    if (!got[i] || got[i].challenge !== expected[i].challenge) {
      return { ok: false, reason: 'challenge', index: i };
    }
    const want = expected[i].edgeIndices;
    const have = got[i].edgeIndices;
    if (!Array.isArray(have) || have.length !== want.length) {
      return { ok: false, reason: 'edges', index: i };
    }
    for (let j = 0; j < want.length; j++) {
      if (have[j] !== want[j]) return { ok: false, reason: 'edges', index: i };
    }
  }
  return { ok: true };
}
