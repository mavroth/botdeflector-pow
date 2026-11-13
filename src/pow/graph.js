import { compileFill } from './digest.js';
import { normalizeParams } from './params.js';

export function finishGraph(us, vs, numNodes, numEdges, seed) {
  const degree = new Int32Array(numNodes);
  for (let e = 0; e < numEdges; e++) {
    degree[us[e]]++;
    degree[vs[e]]++;
  }

  const offsets = new Int32Array(numNodes + 1);
  for (let i = 0; i < numNodes; i++) offsets[i + 1] = offsets[i] + degree[i];
  if (offsets[numNodes] !== numEdges * 2) {
    throw new Error('degree sum does not match the edge count');
  }

  const neighbors = new Int32Array(numEdges * 2);
  const edgeIndices = new Int32Array(numEdges * 2);
  const cursor = new Int32Array(numNodes);
  cursor.set(offsets.subarray(0, numNodes));

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

  return { nodes: numNodes, edges: numEdges, offsets, neighbors, edgeIndices, seed };
}

export function buildGraph(params) {
  const norm = params && params.seed !== undefined && params.nodesBits !== undefined
    ? params
    : normalizeParams(params);
  const numNodes = 1 << norm.nodesBits;
  const numEdges = 1 << norm.edgesBits;
  const us = new Int32Array(numEdges);
  const vs = new Int32Array(numEdges);
  compileFill(norm.seed)(0, numEdges, numNodes - 1, us, vs);
  return finishGraph(us, vs, numNodes, numEdges, norm.seed);
}
