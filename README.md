<p align="center">
  <img src="./assets/readme-header.svg" alt="Nim Stalker header" width="960" />
</p>

# ✦ Nim Stalker ✦

**Ever wondered where your NIM went? Now you can stalk it.**

A blockchain transaction graph visualizer for Nimiq. Search any address, watch the connections unfold, and discover the hidden web of transactions — all rendered as a beautiful interactive graph.

> *Think of it as Six Degrees of Kevin Bacon, but for crypto wallets.* 🥓

## What It Does

Nim Stalker ingests Nimiq blockchain transactions, stores both raw and aggregated graph relationships in Neo4j, and serves them through a Bun + Elysia API. The Next.js frontend renders that data as an interactive graph and transaction timeline with path search, filtering, live balance refresh, and export tools.

It's like a map — but instead of roads, you see money flowing.

## Architecture at a Glance

```text
Nimiq RPC (HTTP + block stream)
  -> Blockchain indexer (backfill + live subscription + gap repair)
  -> Neo4j graph storage (Address, TRANSACTION, TRANSACTED_WITH)
  -> Elysia API on Bun (graph, address, tx, indexer routes)
  -> Next.js 15 + Cytoscape + Zustand frontend
```

Current stack:
- API: Elysia on Bun.
- Web: Next.js 15, React 18, Cytoscape.js, Zustand, Tailwind CSS.
- Database: Neo4j 5.
- Indexer state/checkpoints: SQLite (`INDEXER_DB_PATH`, default `data/indexer.sqlite`).
- Shared contracts: `@nim-stalker/shared` workspace package.

## Core Features

- Interactive graph expansion (`incoming`, `outgoing`, `both`) with value/time filters.
- Path and subgraph discovery between addresses.
- Address details and paginated transaction history.
- Recent transaction feed with DB-first strategy and RPC fallback.
- Home graph auto-refresh.
- Dedicated transaction timeline page (`/address/<slug>/tx...`).
- Address-label autocomplete (shared address book + validator metadata).
- JSON and CSV export from the graph view.
- Live balance refresh through `POST /address/balances/live`.
- Multiple layout categories and modes:
  - Force-directed: `fcose`, `fcose-weighted`, `cola`
  - Hierarchical: `elk-layered-down`, `elk-layered-right`, `dagre-tb`, `dagre-lr`
  - Flow: `directed-flow`, `biflow-lr`, `biflow-tb`
  - Other: `elk-stress`, `concentric-volume`

## Repository Structure

- `/Users/albermonte/nimiq/nimiq-graph/apps/api`
- `/Users/albermonte/nimiq/nimiq-graph/apps/web`
- `/Users/albermonte/nimiq/nimiq-graph/packages/shared`
- `/Users/albermonte/nimiq/nimiq-graph/docker-compose.yml`
- `/Users/albermonte/nimiq/nimiq-graph/docker-compose.prod.yml`
- `/Users/albermonte/nimiq/nimiq-graph/docker/nimiq-client.toml`

## Getting Started

### Docker Development (Recommended)

1. Configure environment values.

```bash
cp .env.example .env
```

At minimum set `NEO4J_PASSWORD` in `.env`.

2. Create the external Neo4j volume once.

```bash
docker volume create neo4jdata
```

If you use a custom name, set `NEO4J_VOLUME_NAME` first.

3. Start the development stack.

```bash
docker compose up --build
```

Development services:
- `genesis-init`
- `node-data-init`
- `node`
- `db`
- `api`
- `web`

Default local endpoints:
- Web: `http://localhost:3000`
- API: `http://localhost:3001`
- Neo4j Browser: `http://localhost:7474`
- Neo4j Bolt: `bolt://localhost:7687`

Persistence and ownership:
- Nimiq node data is persisted under `NIMIQ_DATA_DIR` (default `./.data/nimiq`).
- Neo4j data is persisted in external volume `NEO4J_VOLUME_NAME` (default `neo4jdata`).
- Linux hosts can control node data ownership using `NIMIQ_NODE_UID` and `NIMIQ_NODE_GID` (default `1001:1001`).

### Docker Production

1. Provide required production variables:
- `NEO4J_PASSWORD`
- `CORS_ORIGIN`
- `API_KEY`
- `NEXT_PUBLIC_API_URL`

2. Start the production stack:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Production services:
- `genesis-init`
- `node-data-init`
- `node`
- `db`
- `api`
- `web`

### Local Non-Docker Workflow

1. Install dependencies:

```bash
bun install
```

2. Ensure Neo4j and a Nimiq RPC endpoint are reachable.

3. Set API runtime variables before starting:
- `NEO4J_URI` (required)
- `NEO4J_PASSWORD` (required)
- `NEO4J_USER` (optional, default `neo4j`)
- `NIMIQ_RPC_URL` (optional, default `http://localhost:8648`)
- `PORT` (optional, default `3001`)

Also set frontend API URL when needed:
- `NEXT_PUBLIC_API_URL` (for explicit API target)

4. Initialize DB constraints and indexes:

```bash
bun run db:init
```

5. Start all workspaces:

```bash
bun run dev
```

## Configuration

### 1. Core Runtime Variables

These are required by runtime behavior (provided either directly by your shell or by compose wiring):

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NEO4J_URI` | Yes (API runtime) | None | Required by `apps/api/src/lib/config.ts`; compose sets `bolt://db:7687`. |
| `NEO4J_PASSWORD` | Yes | None | Required by API and Neo4j auth. |
| `NEO4J_USER` | No | `neo4j` | Neo4j username. |
| `NIMIQ_RPC_URL` | No | `http://localhost:8648` | API RPC endpoint (`apps/api/src/lib/config.ts`). |
| `PORT` | No | `3001` | API listen port. |
| `NIMIQ_DATA_DIR` | No | `./.data/nimiq` | Compose host path for Nimiq node data. |
| `NIMIQ_NODE_UID` | No | `1001` | Node container UID for host volume ownership. |
| `NIMIQ_NODE_GID` | No | `1001` | Node container GID for host volume ownership. |
| `NEO4J_VOLUME_NAME` | No | `neo4jdata` | External Docker volume name for Neo4j `/data`. |
| `INDEXER_DB_PATH` | No | `data/indexer.sqlite` | SQLite indexer DB path (`apps/api/src/lib/indexer-db.ts`). |

### 2. Production-Only Variables

| Variable | Required in Prod | Default | Notes |
|---|---|---|---|
| `CORS_ORIGIN` | Yes | None | Must be explicit in production API (not `*`). |
| `API_KEY` | Yes | None | Required for non-main-origin access to sensitive endpoints in production. |
| `NEXT_PUBLIC_API_URL` | Yes | None | Required for production web image build/runtime in compose. |
| `MAIN_ORIGIN_HOSTS` | No | `localhost,nimstalker.com,www.nimstalker.com` (compose) | Comma-separated first-party origins for API-key bypass path. |

### 3. Advanced Tuning Variables

Neo4j memory and container limits:

| Variable | Default (Dev Compose) | Default (Prod Compose) |
|---|---|---|
| `NEO4J_HEAP_INITIAL` | `512m` | `512m` |
| `NEO4J_HEAP_MAX` | `1G` | `1G` |
| `NEO4J_PAGECACHE` | `512m` | `2G` |
| `NEO4J_MEMORY_LIMIT` | `3G` | `6G` |
| `NEO4J_TX_MEMORY_MAX` | `512m` | `512m` |

Indexer, aggregate, and repair tuning:

| Variable | Default |
|---|---|
| `BACKFILL_CHECKPOINT_INTERVAL` | `100` |
| `BACKFILL_THROTTLE_MS` | `0` |
| `BACKFILL_THROTTLE_EVERY_BATCHES` | `10` |
| `BACKFILL_DEFER_AGGREGATES` | `true` |
| `BACKFILL_RPC_PREFETCH` | `4` |
| `GAP_REPAIR_INTERVAL_MS` | `300000` |
| `GAP_REPAIR_MAX_PER_CYCLE` | `50` |
| `LIVE_TRANSITION_GAP_BUDGET_MS` | `5000` |
| `LIVE_DEFER_AGGREGATES` | `true` |
| `VERIFY_BATCH_DEFER_AGGREGATES` | `true` |
| `VERIFY_BATCH_AGGREGATE_PAIR_BATCH_SIZE` | `5` |
| `VERIFY_BATCH_AGGREGATE_FLUSH_LIMIT` | `50` |
| `VERIFY_BATCH_AGGREGATE_FLUSH_TICK_MS` | `1000` |
| `EDGE_AGGREGATE_PAIR_CHUNK_SIZE` | `5` |
| `UPDATE_ADDRESS_TXCOUNT_ON_PAIR_UPDATE` | `false` |
| `REBUILD_PHASE1_CHUNK_SIZE` | `1000` |
| `REBUILD_PHASE1_ROWS_PER_TX` | `250` |
| `REBUILD_PHASE2_CHUNK_SIZE` | `1000` |
| `REBUILD_PHASE2_ROWS_PER_TX` | `250` |
| `REBUILD_CHUNK_RETRY_ATTEMPTS` | `3` |
| `REBUILD_CHUNK_RETRY_BASE_DELAY_MS` | `2000` |
| `REBUILD_CHUNK_RETRY_MAX_DELAY_MS` | `30000` |
| `REBUILD_STRATEGY` | `keyset` |

Sensitive endpoint rate limit controls:

| Variable | Default |
|---|---|
| `SENSITIVE_RATE_LIMIT_WINDOW_MS` | `60000` |
| `SENSITIVE_RATE_LIMIT_PER_WINDOW` | `300` |
| `SENSITIVE_RATE_LIMIT_MAIN_ORIGIN_PER_WINDOW` | `100000` |

## HTTP API Reference

| Method | Route | Description | Key params and limits |
|---|---|---|---|
| `GET` | `/` | API metadata | Returns API name/version payload. |
| `GET` | `/health` | Health check | Returns `healthy` or `unhealthy` based on Neo4j connectivity. |
| `POST` | `/address/balances/live` | Fetch and persist live balances for addresses | Body: `addresses` array, min 1, max 100. |
| `GET` | `/address/:addr` | Get address metadata | Validates Nimiq address; creates/fills from RPC if missing. |
| `GET` | `/address/:addr/transactions` | Paginated transaction history for an address | `page`, `pageSize` (max 100), `direction`, optional timestamp/value filters. |
| `POST` | `/graph/expand` | Expand graph neighborhood | Body `addresses` (1..50), `direction`, optional filters (`limit` max 500, time/value bounds). |
| `GET` | `/graph/path` | Shortest path query | Query: `from`, `to`, `maxDepth` (1..10, default 6). |
| `GET` | `/graph/subgraph` | All-shortest-path subgraph between two addresses | Query: `from`, `to`, `maxHops` (1..10, default 3), `directed` boolean. |
| `GET` | `/graph/nodes` | Fetch specific nodes by id list | Query: `ids` CSV, max 100 ids. |
| `GET` | `/graph/latest-blocks` | Build graph slice from latest blocks | Query: `count` (1..50, default 10). |
| `GET` | `/transactions/recent` | Recent global transactions feed | `page`, `pageSize` (clamped to max 200). DB-first with RPC fallback on timeout/failure. |
| `GET` | `/transaction/:hash` | Transaction by hash | 64-hex hash required; DB-first then RPC fallback. |
| `GET` | `/indexer/status` | Indexer runtime and progress state | Includes batch, gap, queue, and progress fields. |
| `GET` | `/indexer/verify` | Backfill integrity verification | Query: `sample` (1..50), `includeGapList=true|false`. |

## Security and Rate Limiting

Sensitive endpoint policy is enforced only when `NODE_ENV=production`.

Sensitive routes:
- `GET /graph/subgraph`
- `GET /graph/latest-blocks`
- `GET /indexer/verify`

Policy behavior in production:
- All sensitive routes are rate-limited.
- Main-origin requests (from `MAIN_ORIGIN_HOSTS`) use the high first-party limit.
- Non-main-origin requests must provide `x-api-key: <API_KEY>`.
- Rate-limit headers are emitted (`x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`).

## Frontend Routes and Deep Links

Canonical frontend routes:
- `/`
- `/address/<address-slug>`
- `/address/<address-slug>/tx?direction=<incoming|outgoing|both>&limit=<50|100|200|500>`
- `/tx/<64-hex-hash>`
- `/path?from=<address-slug>&to=<address-slug>&maxHops=<1-10>&directed=<true|false>`

Notes:
- `address-slug` is an uppercase spaceless Nimiq address.
- Invalid route params are validated client-side and redirected to `/`.

## Data Model and Indexing Behavior

Neo4j model:
- `(:Address)` nodes store address metadata (`id`, `type`, `balance`, `txCount`, optional label timestamps).
- `[:TRANSACTION]` relationships store raw transactions (`hash`, `value`, `fee`, `blockNumber`, `timestamp`, `data`).
- `[:TRANSACTED_WITH]` relationships store directional aggregates with:
  - `txCount`
  - `totalValue`
  - `firstTxAt`
  - `lastTxAt`

Indexer behavior:
- Opens SQLite checkpoint DB (`INDEXER_DB_PATH`) for indexed batch tracking and metadata.
- Runs backfill first, then starts live block subscription.
- Performs periodic gap repair for missing batches.
- Can defer aggregate updates into a queued background flush path.
- Can rebuild all aggregates after backfill (`REBUILD_*`, `REBUILD_STRATEGY`).

Labeling and caching:
- Address labels come from shared address book plus validator API metadata.
- API address cache TTL is 5 minutes.
- Web API client caches by endpoint TTL (latest graph, address, recent tx, etc.).

## 🎨 Design System

The UI follows a **Peanut.me-inspired** palette with playful, bold aesthetics:

| Color | Hex | Usage |
|-------|-----|-------|
| 🌸 Pink | `#FF90E8` | Primary actions, selection highlights, sparkle accents |
| 💜 Pink Dark | `#E91E8C` | Hover states, emphasis |
| 💠 Periwinkle | `#8B8BF5` | Path overlays, secondary actions |
| 🌟 Yellow | `#FFC900` | Root nodes, warnings, sparkle accents |
| 🍦 Cream | `#FAF4F0` | Backgrounds |
| 🟣 Purple | `#6340DF` | Accents |

Style hallmarks: `border-2`, `rounded-sm` (2px), offset shadows (`4px 4px`), active press effects on buttons, and sparkle (✦) decorations.

## Testing and CI

Local commands:

```bash
bun run test
bun run lint
bun run build
```

Current GitHub Actions workflow (`.github/workflows/test.yml`) runs:
- dependency install (`bun install --frozen-lockfile`)
- tests (`bun run test`)
- lint (`bun run lint`)
- security gate (`bun audit`) that fails on high/critical findings

## Custom Node Recommendation

This project runs against a **slim Albatross node** — a stripped-down fork of the Nimiq PoS node optimized for indexing and RPC queries.

- [core-rs-albatross-slim](https://github.com/Albermonte/core-rs-albatross-slim)

You can still point Nim Stalker at any compatible RPC endpoint using `NIMIQ_RPC_URL`

---

<p align="center">
  <em>Built with ✦ pink sparkles and mass surveillance energy ✦</em>
</p>
