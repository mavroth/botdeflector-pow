const MIN_BITS = 2;
const MAX_BITS = 22;

function integer(value, name) {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }
  return value;
}

function inRange(value, name, min, max) {
  if (value < min || value > max) {
    throw new RangeError(`${name} must be between ${min} and ${max}`);
  }
}

/**
 * Accept the wire names from a challenge payload and the camelCase aliases.
 * The graph seed defaults to the session id when the payload does not set one.
 */
export function normalizeParams(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('params object required');
  }
  const nodesBits = integer(input.NODES_BITS ?? input.nodesBits, 'NODES_BITS');
  const edgesBits = integer(input.EDGES_BITS ?? input.edgesBits, 'EDGES_BITS');
  const cycleLength = integer(input.CYCLE_LENGTH ?? input.cycleLength, 'CYCLE_LENGTH');
  const seed = input.GRAPH_SEED ?? input.graphSeed ?? input.sessionId ?? '';
  if (typeof seed !== 'string') throw new TypeError('GRAPH_SEED must be a string');
  inRange(nodesBits, 'NODES_BITS', MIN_BITS, MAX_BITS);
  inRange(edgesBits, 'EDGES_BITS', MIN_BITS, MAX_BITS);
  inRange(cycleLength, 'CYCLE_LENGTH', 3, 64);
  return { nodesBits, edgesBits, cycleLength, seed };
}

export function paramsFromPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new TypeError('payload required');
  if (!Array.isArray(payload.challenges)) {
    throw new TypeError('payload.challenges must be an array');
  }
  const base = payload.params && typeof payload.params === 'object' ? payload.params : {};
  return normalizeParams({
    ...base,
    GRAPH_SEED: base.GRAPH_SEED ?? base.graphSeed ?? payload.sessionId ?? '',
  });
}
