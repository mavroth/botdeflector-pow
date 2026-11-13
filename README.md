# botdeflector-pow

Node.js proof of work for a graph-cycle challenge. One package issues a session, solves it, and checks the answer. Node 20 or newer. No dependencies.

## The puzzle

A session is one graph plus a list of challenge hashes.

The parameters are:

| field | meaning | usual value |
| --- | --- | --- |
| `NODES_BITS` | the graph has `2^NODES_BITS` nodes | 14 |
| `EDGES_BITS` | the graph has `2^EDGES_BITS` edges | 16 |
| `CYCLE_LENGTH` | the walk you must close | 8 |

The seed is `params.GRAPH_SEED` when that field is set, and `sessionId` otherwise. Edge `e` joins two nodes:

```text
digest = SHA-256( uint32le(e) || seed )
u      = first 4 bytes of digest, masked to the node count
v      = bytes 8..11 of the same digest, masked the same way
```

The edge is undirected. Neighbours are stored in the order the edges were created, so a walk that follows that order is fixed.

Each challenge is hex. It does not build a new graph. SHA-256 of the raw challenge bytes picks the node where the walk starts. The search then looks for a simple cycle of exactly `CYCLE_LENGTH` edges and returns the edge numbers along that walk.

The cycle that verifies is the first one that walk finds. A different cycle of the same length is a different answer. Every challenge in a session shares the graph, so build it once and reuse it.

## Payload

```json
{
  "sessionId": "4f0c2a18-6b1e-4d77-9a30-2c8e5b71d6aa",
  "challenges": [
    "a4c1e09b7d2f48c6b1aa33e0d95c7741f6b08e2d4c7a19f35e6d80b2c4f17a90"
  ],
  "params": {
    "NODES_BITS": 14,
    "EDGES_BITS": 16,
    "CYCLE_LENGTH": 8
  }
}
```

The solver writes:

```json
{
  "solution": [
    {
      "challenge": "a4c1e09b7d2f48c6b1aa33e0d95c7741f6b08e2d4c7a19f35e6d80b2c4f17a90",
      "edgeIndices": [536, 2767, 33939, 35782, 41216, 2182, 14684, 32394]
    }
  ]
}
```

That list is from the checked vector in `test/vector.json`, seed `mavroth-pow-v1`.

## Solve

```js
import { solve } from './src/index.js';

const { solution, graph, timings } = await solve(payload);
```

`timings` is `{ buildMs, searchMs, parallel }`. Graphs with `EDGES_BITS` of 18 or more are hashed on a worker pool. Smaller graphs stay on the caller thread. `{ parallel: true }` or `{ parallel: false }` forces the path.

```js
import { solveSync } from './src/index.js';

const { solution, graph } = solveSync(payload);
const again = solveSync(payload, graph);
```

`solveChallenges(challenges, params, graph)` is the lower-level call. Parameter objects accept `NODES_BITS` or `nodesBits`, and the same for the other fields.

## Issue and check

```js
import { issueSession, solveSync, verifySolution } from './src/index.js';

const payload = issueSession({
  nodesBits: 14,
  edgesBits: 16,
  cycleLength: 8,
  count: 3,
});

const { solution, graph } = solveSync(payload);
verifySolution(payload, { solution }, graph);
// { ok: true }
```

`verifySolution` repeats the walk and compares edge indices. Pass the graph you already built. A bad edge comes back as `{ ok: false, reason: 'edges', index }`.

`issueSession` defaults to 3 challenges, a random session id, and the light parameters above. `count` runs from 1 to 256. `NODES_BITS` and `EDGES_BITS` run from 2 to 22. `CYCLE_LENGTH` runs from 3 to 64.

## Command line

```bash
node bin/solve.js payload.json
node bin/solve.js payload.json --parallel
node bin/solve.js --sync < payload.json
```

Standard output is the solution body. The timing line goes to standard error.

```bash
npm test
npm run bench
npm run bench:heavy
```

## Where the time goes

Hashing one short block per edge is almost the whole build. The hasher stays hot across sessions: the seed block is fixed, and only the 4-byte edge index changes. Seeds longer than 51 bytes spill into a second block and use `node:crypto`.

The search is an explicit stack over the neighbour lists. It skips a neighbour when that neighbour is the node it just left, and it closes only on the start node at exactly `CYCLE_LENGTH` edges.

On an Apple M4 Max, Node 20:

| light vector, 3 challenges | graph build | cycle search |
| --- | ---: | ---: |
| `createHash` once per edge | ~86 ms | |
| this package, warmed up | ~30 ms | ~3 ms |

| 2^20 edges, 4 challenges | graph build |
| --- | ---: |
| one thread | ~615 ms |
| worker pool, warmed up | ~116 ms |

The pool pays off at `EDGES_BITS >= 18`. Below that, starting workers costs more than it saves.

## Layout

```text
src/index.js            public exports
src/pow/digest.js       edge hashing
src/pow/graph.js        neighbour lists
src/pow/search.js       cycle walk
src/pow/session.js      issue, solve, verify
src/pow/pool.js         worker pool
src/pow/worker.js       pool thread
src/pow/params.js       payload parsing
bin/solve.js            command-line solver
bin/bench.js            timings
test/vector.json        checked session
```
