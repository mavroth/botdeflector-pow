import { createHash } from 'node:crypto';

function assertHex(challenge) {
  if (typeof challenge !== 'string' || challenge.length === 0 || challenge.length % 2 !== 0) {
    throw new TypeError('challenge is not hex');
  }
  for (let i = 0; i < challenge.length; i++) {
    const c = challenge.charCodeAt(i);
    const hex = (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
    if (!hex) throw new TypeError('challenge is not hex');
  }
}

/** sha256 of the challenge bytes, not the hex text. Low bits select the DFS origin. */
export function computeStartIndex(challengeHex, numNodes) {
  assertHex(challengeHex);
  if (!Number.isInteger(numNodes) || numNodes < 2 || (numNodes & (numNodes - 1)) !== 0) {
    throw new RangeError('numNodes must be a power of two');
  }
  const digest = createHash('sha256').update(Buffer.from(challengeHex, 'hex')).digest();
  return digest.readUInt32LE(0) & (numNodes - 1);
}

/**
 * First simple cycle of exactly `cycleLength` edges.
 *
 * Neighbours are visited in CSR insertion order. A neighbour is skipped when it
 * is the node we just came from (every edge between those two nodes, not only
 * the edge id we arrived on). The cycle closes only on the origin, and only
 * when the walk is exactly cycleLength edges long. That is the cycle a checker
 * recomputes; a different valid cycle is a different answer.
 */
export function findCycle(graph, cycleLength, startOffset) {
  if (!Number.isInteger(cycleLength) || cycleLength < 3) {
    throw new RangeError('cycleLength must be an integer >= 3');
  }
  const { offsets, neighbors, edgeIndices, nodes } = graph;
  const onPath = new Uint8Array(nodes);
  const sNode = new Int32Array(cycleLength);
  const sParent = new Int32Array(cycleLength);
  const sVia = new Int32Array(cycleLength);
  const sDepth = new Int32Array(cycleLength);
  const sPos = new Int32Array(cycleLength);
  const sEnd = new Int32Array(cycleLength);
  const edgePath = new Int32Array(cycleLength);

  for (let k = 0; k < nodes; k++) {
    const start = (startOffset + k) % nodes;
    onPath[start] = 1;
    sNode[0] = start;
    sParent[0] = -1;
    sVia[0] = -1;
    sDepth[0] = 0;
    sPos[0] = offsets[start];
    sEnd[0] = offsets[start + 1];
    let sp = 1;
    let ep = 0;

    while (sp) {
      const top = sp - 1;
      const pos = sPos[top];
      if (pos >= sEnd[top]) {
        onPath[sNode[top]] = 0;
        if (sVia[top] !== -1) ep--;
        sp--;
        continue;
      }
      sPos[top] = pos + 1;
      const nb = neighbors[pos];
      const eidx = edgeIndices[pos];
      if (nb === sParent[top]) continue;
      const depth = sDepth[top];
      if (onPath[nb]) {
        if (nb === start && depth + 1 === cycleLength) {
          const out = new Array(ep + 1);
          for (let i = 0; i < ep; i++) out[i] = edgePath[i];
          out[ep] = eidx;
          return out;
        }
      } else if (depth + 1 < cycleLength) {
        onPath[nb] = 1;
        edgePath[ep++] = eidx;
        sNode[sp] = nb;
        sParent[sp] = sNode[top];
        sVia[sp] = eidx;
        sDepth[sp] = depth + 1;
        sPos[sp] = offsets[nb];
        sEnd[sp] = offsets[nb + 1];
        sp++;
      }
    }
  }
  return null;
}
