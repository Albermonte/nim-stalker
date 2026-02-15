# Nim Stalker

<!-- AUTO-MANAGED: project-description -->
Transaction graph visualization for Nimiq blockchain. Next.js frontend with Cytoscape.js, Elysia API backend with Neo4j graph database, indexing via Nimiq JSON-RPC 2.0.
<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: build-commands -->
## Build Commands

```bash
# Development
bun run dev                    # Start all apps (Turborepo)
docker compose up              # Full stack (Neo4j + API + Web)

# Build & Test
bun run build                  # Build all
bun run test                   # Tests with coverage
bun run lint                   # Linting

# Database
bun run db:init                # Ensure Neo4j constraints/indexes
```
<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Architecture

```
nim-stalker/
├── apps/
│   ├── api/                   # Elysia REST API (Bun)
│   │   └── src/
│   │       ├── lib/           # neo4j, config, address-cache, address-utils
│   │       ├── routes/        # health, address, graph
│   │       ├── services/      # nimiq-rpc, graph, path-finder, subgraph-finder, transaction-utils
│   │       └── test/          # setup, fixtures/, mocks/, helpers/
│   └── web/                   # Next.js frontend
│       ├── app/               # App Router (globals.css, layout, page)
│       ├── components/        # graph/ (Canvas, Controls, ErrorBoundary, ContextMenu), sidebar/ (Search, Filter, Details)
│       ├── lib/               # api, format-utils, layout/ (multi-root preset engine)
│       ├── store/             # graph-store (Zustand)
│       ├── types/             # cytoscape-cola.d.ts (module declarations)
│       └── test/              # setup, helpers/, mocks/
├── packages/shared/           # Shared types
└── docker-compose.yml         # Neo4j + API + Web
```

**Neo4j Graph Model:**
- `(:Address {id, type, label, balance, firstSeenAt, lastSeenAt, indexStatus, indexedAt})` — nodes
- `[:TRANSACTION {hash, value, fee, blockNumber, timestamp, data}]` — raw transaction relationships
- `[:TRANSACTED_WITH {txCount, totalValue, firstTxAt, lastTxAt}]` — pre-aggregated edge summaries

**Constraints/Indexes** (created at startup via `ensureConstraints()`):
- Unique: `Address.id`, `TRANSACTION.hash`
- Index: `Address.indexStatus`, `TRANSACTION.timestamp`, `TRANSACTION.blockNumber`, `TRANSACTED_WITH.txCount`

**API Routes:** `GET /health`, `GET|POST /address/:addr[/transactions|/index]`, `POST /graph/expand`, `GET /graph/path|subgraph|nodes|latest-blocks`
<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Conventions

**Address Handling:**
- Format: `NQ42 XXXX XXXX ...` (spaces every 4 chars, 36 total)
- Backend: `address-utils.ts` → `isValidNimiqAddress()` (regex: NQ + 2 digits + 32 alnum, space-insensitive), `formatAddress()` (normalize to uppercase, space every 4 chars), `truncateAddress()` (first4...last4 if >11 chars)
- Frontend: `format-utils.ts` → `formatNimiqAddress()`, `formatNimiq()`, `getNimiqWatchUrl()`, `formatDate()`, `truncateAddress()` (first4...last4 if >11 chars, used for node labels in graph-store)
- Validation: `@nimiq/utils` `ValidationUtils.isValidAddress()`
- Tests: Shared fixtures in `test/fixtures/addresses.ts` (validAddresses, invalidAddresses, addressPairs)

**Services:** Singleton factories (`getNimiqService()`, `getGraphService()`, etc.), lazy initialization

**Types:** Shared in `@nim-stalker/shared` (AddressType, IndexStatus enums), Elysia `t.Object()` for validation. Web tsconfig excludes `test/`, `**/*.test.ts`, `**/*.test.tsx` from compilation (tests run via Bun natively).

**Neo4j Driver:**
- `neo4j.ts` exports: `getDriver()`, `readTx(work)`, `writeTx(work)`, `toNumber()`, `toBigIntString()`, `toDate()`, `toISOString()`, `ensureConstraints()`, `closeDriver()`
- `readTx`/`writeTx` auto-manage sessions (open, execute, close)
- Use `neo4j.int()` for integer parameters (LIMIT, SKIP, blockNumber)
- Store large values as strings (balance, totalValue, value, fee) for BigInt precision

**Errors:** 400/500 status codes, `{ error }` responses, Error Boundary for graph

**Environment:**
- API: `NEO4J_URI` (required), `NEO4J_USER` (default `neo4j`), `NEO4J_PASSWORD` (required), `NIMIQ_RPC_URL` (defaults to `http://localhost:8648`), `PORT=3001`, `CORS_ORIGIN` (required in prod)
- Web: `NEXT_PUBLIC_API_URL`

**Graph Design System (Peanut.me inspired):**
- Colors: pink (#FF90E8), pink-dark (#E91E8C), periwinkle (#8B8BF5), yellow (#FFC900), cream (#FAF4F0), purple (#6340DF)
- Tailwind namespace: `nq-pink[-light|-dark]`, `nq-periwinkle[-light]`, `nq-yellow[-light]`, `nq-purple`, `nq-cream`, `nq-black`, `nq-white` (defined in `tailwind.config.ts`); backward-compat `nimiq-blue`, `nimiq-gold`, `nimiq-light` retained
- Classes: `nq-card[-pink|-periwinkle|-yellow|-cream]`, `nq-btn[-pink|-periwinkle|-yellow|-white|-outline]`, `nq-tag[-pink|-periwinkle|-yellow|-green|-red]`, `nq-input[-dark]`, `nq-select`, `nq-label`, `nq-sparkle`
- Style: 2px borders (`border-2`), minimal radius (`rounded-sm` = 2px), offset shadows (nq: `4px 4px`, nq-sm: `2px 2px`, nq-lg/nq-hover: `6px 6px`); buttons use active press effect (`translate-x-[3px] translate-y-[4px] shadow-none`) with hover shadow lift to `5px 5px`; sparkle (✦) decorations with pink before / yellow after
- Note: CSS classes and custom properties use `nq-*` / `--nq-*` format.
- Error Boundary: `nq-card` with `nq-btn-pink` retry button, error details in collapsible `<details>` with monospace pre block

**Docker:** Build from root, Bun runtime for API, Node for web prod. Volume mounts bind host source directories into containers (`apps/api/src`, `apps/web/{app,components,lib,store}`, `packages/shared`) for live code access. Compose `develop.watch` configured: `sync` for source dirs (ignoring test files `**/*.test.ts`, `**/__tests__/**`), `rebuild` on `package.json` changes. Package sync targets `packages/shared` specifically rather than the full `packages/` tree.
<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: patterns -->
## Patterns

**Graph Format (Cytoscape.js):**
```typescript
{ nodes: [{ data: { id, label, type, balance, indexStatus, txCount } }],
  edges: [{ data: { id, source, target, txCount, totalValue, firstTxAt, lastTxAt } }] }
```

**Path Finding:**
- Neo4j native `shortestPath` for single shortest path, max 6 hops
- Neo4j native `allShortestPaths` for subgraph extraction, max 10 hops, optional directed mode
- Returns `{ found, subgraph, stats: { nodeCount, edgeCount, maxHops, shortestPath, directed } }`

**Graph Expansion:** Direction (`incoming|outgoing|both`), filters (timestamp/value/limit), batch transaction counting via `batchCountTransactions()`

**Address Indexing:** Status flow: PENDING → INDEXING → COMPLETE|ERROR. Fetches account + transactions via Nimiq JSON-RPC (`getAccountByAddress`, `getTransactionsByAddress` with cursor pagination), stores as TRANSACTION relationships, aggregates into TRANSACTED_WITH edges. Supports incremental re-indexing (fetches only new transactions when status is already COMPLETE).

**Frontend Visualization:**
- Dynamic import `ssr: false`, three layout modes selectable via UI toggle:
  - **fcose** (force-directed): Default (repulsion 15000, edge length 250, fit:true, gravity 0.08), Path view (repulsion 18000, edge length 300, fit:true, gravity 0.03). Incremental expansion (2nd+ node): locks all existing nodes, relocates expanded node away from cluster centroid (base 900 + sqrt(newNodes)*150 + density*100 px offset), positions new nodes radially around it, then runs fcose (repulsion 20000, edgeLength 300, fit:false, gravity 0) on new elements only with fixedNodeConstraint anchoring the expanded node; unlocks all on layoutstop
  - **cola** (constraint-based): nodeSpacing 40, edgeLength 200, avoidOverlap:true, handleDisconnected:true, convergenceThreshold 0.01
  - **multi-root** (deterministic preset): `computeMultiRootPresetPositions` from `@/lib/layout` — roots on circle, single-owner clouds in radial rings, shared nodes along spine between owners, unreachable in parking ring. Supports incremental updates preserving existing positions.
- Layout module (`lib/layout/`): types, vector-math, hash-utils (FNV-1a 64-bit for deterministic angles), graph-utils (BFS, adjacency, node classification, incident-value map), collision-avoidance (single-pass push-apart), layout-multi-root-preset (main algorithm)
  - `buildAdjacencyUndirected(edges, nodes?)`: optional `nodes` param ensures isolated roots (no edges) appear in adjacency list — critical for correct BFS distance maps
  - `classifyNodesByOwners`: single-owner clouds, shared buckets (sorted comma-joined key for determinism), parking set
  - `computeIncidentValueMap`: bigint sum of `totalValue` on incident edges per node, used to sort shared nodes by importance
  - Config note: `types.ts` exports `DEFAULT_CONFIG` with looser spacing (rootRingRadius 2000, baseRadius 250, ringStep 180, parkingRadius 3000, minNodeDistance 90); the algorithm in `layout-multi-root-preset.ts` uses its own tighter `DEFAULTS` (rootRingRadius 1400, baseRadius 170, ringStep 120, parkingRadius 2200, minNodeDistance 55)
- Identicon pipeline: SVG generated via `identicons-esm`, cached in module-level `identiconCache` Map; async SVG→PNG conversion via `svgToPng()` (128px canvas, reused across calls) for zoom-safe rendering; `pendingConversions` Set prevents duplicate async work; `generateIdenticonDataUri()` returns cached PNG if available, else SVG fallback while kicking off background PNG conversion; Cytoscape node updated in-place when PNG ready
- Node: 64x64 identicons, 3px border, labels below (text-valign bottom, margin-y 8), pink selection overlay (pink border + 0.2 opacity overlay). Root nodes: yellow 4px border, 72x72 (`node.root-node` class)
- Edge: width scales with txCount via `mapData(txCount, 1, 300, 3, 15)`, colors: gray-400 default, pink (#FF69B4) outgoing, green (#22C55E) incoming, periwinkle (#8B8BF5) path
- Path view: saves/restores graph state, colored overlays (periwinkle start, yellow intermediate, pink end)
- Context menu: hover:bg-nq-pink for actions, root toggle (✦ Set as Root / ✦ Remove from Roots) shown only in multi-root layout mode — yellow hover when active, pink hover when inactive; remove uses text-red-500 / hover:bg-red-500
- SearchPanel: `validateAndCleanAddress()` strips whitespace + uppercases + validates via `@nimiq/utils`; `createKeyDownHandler()` wraps Enter-key submission; export via `getCytoscapeElements()` to JSON or CSV blob download
- Cytoscape style objects use `as any` — TS types don't cover all valid CSS properties (e.g. background-image-smoothing, overlay-shape)

**Zustand Store:**
- Map-based state with explicit recreation pattern for reactivity
- Actions: `addNodes/Edges`, `updateNode`, `indexNode`, `searchAddress`, `addAddress`, `enterPathView`, `exitPathView`
- In-flight request tracking prevents duplicate concurrent operations
- Path mode: `pathMode.active/from/to/maxHops/directed`, `pathView.active/pathNodeIds/savedNodes`
- Layout mode: `layoutMode` ('fcose' | 'cola' | 'multi-root'), `rootNodeIds` (Set). Actions: `setLayoutMode`, `toggleRootNode`, `addRootNode`, `removeRootNode`, `clearRootNodes`. First searched/added address auto-becomes root.

**Caching:**
- Backend: `addressCache` 60s TTL, batch ops (`getMultiple`, `setMultiple`)
- Frontend: API client 30s TTL cache

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Dependencies

**Runtime:** `elysia`, `@elysiajs/cors`, `neo4j-driver`, `next`, `react`, `cytoscape`, `cytoscape-fcose`, `cytoscape-cola`, `zustand`, `sonner`, `@nimiq/utils`, `identicons-esm`

**Build:** `turbo`, `bun`, `typescript`, `tailwindcss`

**Test:** `bun:test`, `@testing-library/react`, `@testing-library/jest-dom`, `happy-dom`
<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: git-insights -->
## Git Insights

**Key Commits:**
- `eac912b`: Initialize monorepo (Turborepo + Bun)
- `71db0d1`: Migrate to NimiqHub REST API
- `456ccca`: Production hardening (config validation, rate limiting, error boundaries)
- `6658ac7`: Graph design system (pink/periwinkle/yellow palette)
- `f8c86da`: Peanut.me color palette refresh (pink #FF90E8, yellow #FFC900, cream #FAF4F0, added purple), minimal radius (rounded-sm 2px), border-2, active press button effect
- `acdf920`: Subgraph finding with max hops and directed options
- `294f82c`: Multi-root preset layout engine (deterministic, FNV-1a hashing, collision avoidance); node labels via `truncateAddress` in `/latest-blocks` response
- `3dd26fd`: Multi-root layout algorithm with graph utilities — graph-utils (adjacency, BFS, node classification), hash-utils (deterministic angles), vector-math, collision avoidance; SVG→PNG async identicon pipeline for zoom-safe rendering; cola layout registration; isolated root handling via optional nodes param in adjacency builder

**Key Decisions:**
- Elysia over Express (performance, type safety)
- Neo4j over PostgreSQL (native graph traversal, shortestPath, TRANSACTED_WITH aggregation)
- Neo4j native `shortestPath`/`allShortestPaths` replacing hand-coded bidirectional BFS
- Map-based Zustand state (granular updates, proper reactivity)
- In-memory caching (address 60s, API 30s TTL)
- Bun native test runner (consistency, speed, native TS)
- Custom deterministic layout over force-directed for stable, reproducible graph positioning (multi-root preset via FNV-1a hashed angles, BFS-based node classification)
- `nq-*` CSS namespace for design system — scoped Tailwind colors and utility classes prevent conflicts, `--nq-*` custom properties mirror palette
<!-- END AUTO-MANAGED -->
