<p align="center">
  <img src="./assets/readme-header.svg" alt="Nim Stalker header" width="960" />
</p>

# ✦ Nim Stalker ✦

**Ever wondered where your NIM went? Now you can stalk it.** 👀

A blockchain transaction graph visualizer for Nimiq. Search any address, watch the connections unfold, and discover the hidden web of transactions — all rendered as a beautiful interactive graph.

> *Think of it as Six Degrees of Kevin Bacon, but for crypto wallets.* 🥓

---

## 🔍 What Is This?

Nim Stalker takes Nimiq blockchain addresses and turns their transaction history into an explorable, interactive graph. Nodes are addresses, edges are aggregated transactions between them. You can expand nodes, find shortest paths between wallets, and zoom into the financial topology of the Nimiq network.

It's like a map — but instead of roads, you see money flowing.

---

## ⚡ How It Works

```
 You search an address
        ↓
 Nimiq RPC fetches transactions (JSON-RPC 2.0)
        ↓
 Neo4j stores the graph (nodes = addresses, edges = aggregated tx)
        ↓
 Elysia API serves it up
        ↓
 Next.js + Cytoscape.js renders an interactive graph
        ↓
 You go "whoa" and expand more nodes 🤯
```

**The pipeline:**
1. **Index** — Batch backfill processes historical batches from genesis; on-demand indexing fetches account + transactions via JSON-RPC with cursor pagination
2. **Store** — Groups by (sender, receiver) pairs and MERGEs into Neo4j `TRANSACTED_WITH` edges with dedup via tx hash arrays
3. **Serve** — Elysia REST API with path finding (`shortestPath`), subgraph extraction, and graph expansion
4. **Live** — WebSocket subscription to head blocks indexes new transactions in real-time
5. **Render** — Cytoscape.js with three layout modes, identicon-based node avatars, and a pink-yellow-periwinkle design system that slaps

The blockchain indexer runs both backfill and live subscription concurrently for full-chain coverage.

---

## 🛠 Tech Stack

| Layer | Tech | Why |
|-------|------|-----|
| **Frontend** | Next.js 15, React, Cytoscape.js, Zustand, Tailwind CSS | App Router, interactive graph viz, reactive state |
| **Backend** | Elysia (Bun runtime) | Fast, type-safe, runs on Bun |
| **Database** | Neo4j | Native graph traversal, `shortestPath`, no JOIN nightmares |
| **Blockchain** | `@albermonte/nimiq-rpc-client-ts` | Typed RPC + WebSocket streaming to a Nimiq node |
| **Build** | Turborepo, Bun, TypeScript | Monorepo with blazing builds |
| **Identity** | `identicons-esm` | Unique visual avatars per address |
| **Validation** | `@nimiq/utils` | Official Nimiq address validation |

---

## ✨ Features

- 🕸️ **Interactive Graph** — Expand addresses, drag nodes, zoom in/out, right-click context menus
- 🔀 **Three Layout Modes** — Force-directed (fcose), constraint-based (cola), and deterministic multi-root preset
- 🛤️ **Path Finding** — Find the shortest path between any two addresses (up to 6 hops)
- 🗺️ **Subgraph Extraction** — Pull out connected subgraphs with configurable max hops and direction
- 🎨 **Identicons** — Every address gets a unique visual identity (SVG → PNG pipeline for crisp rendering at any zoom)
- 🏷️ **Address Labels** — Known addresses display human-readable names and icons
- 🌸 **Design System** — Pink (#FF90E8), yellow (#FFC900), periwinkle (#8B8BF5), cream (#FAF4F0) — inspired by Peanut.me
- ⚡ **Incremental Indexing** — Re-index addresses without duplicating data (tx hash dedup)
- 🔄 **Real-time Indexing** — Batch backfill from genesis + live WebSocket block subscription for full-chain coverage
- 📋 **Job Tracking** — Monitor indexing progress with WebSocket updates
- 🔒 **Security Layer** — Rate limiting + API key authentication for sensitive routes
- 🔍 **Transaction Lookup** — Search by hash (DB first, then RPC fallback)
- 📦 **Export** — Download graph data as JSON or CSV

---

## 🖥️ Custom Nimiq Node

This project runs against a **slim Albatross node** — a stripped-down fork of the Nimiq PoS node optimized for indexing and RPC queries.

👉 **[core-rs-albatross-slim](https://github.com/Albermonte/core-rs-albatross-slim)**

It provides the `getTransactionsByAddress` RPC endpoint with cursor-based pagination that Nim Stalker relies on to index the blockchain.

---

## 🚀 Getting Started

### Docker (recommended)

**Development:**
```bash
docker compose up
```

If you previously ran the production stack on the same host, force a rebuild once:
```bash
docker compose up --build
```

Nimiq chain data is persisted on disk at `./.data/nimiq` by default (configurable with `NIMIQ_DATA_DIR`).
Neo4j graph data is stored in an external Docker volume (`neo4jdata` by default, configurable with `NEO4J_VOLUME_NAME`).
Create it once before first run:
```bash
docker volume create neo4jdata
```
On Linux hosts, if you use a custom path, `node-data-init` will normalize ownership/permissions
for the Nimiq node user (`NIMIQ_NODE_UID` / `NIMIQ_NODE_GID`, defaults `1001:1001`).

This spins up:
- **Neo4j** — Graph database on `bolt://localhost:7687` (browser at `http://localhost:7474`)
- **API** — Elysia server on `http://localhost:3001`
- **Web** — Next.js app on `http://localhost:3000`

**Production** (`docker-compose.prod.yml`):
```bash
docker compose -f docker-compose.prod.yml up -d
```

After code updates, rebuild images before restarting:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Includes:
- **genesis-init** — Downloads Nimiq genesis file
- **node** — Slim Albatross Nimiq node with healthcheck
- **db** — Neo4j with tuned memory settings
- **api** — Production API build
- **web** — Production Next.js build
- **nginx** — Optional reverse proxy (enable with `--profile with-nginx`)

### Local Development

```bash
# Install dependencies
bun install

# Set up environment variables
# API: NEO4J_URI, NEO4J_PASSWORD, NIMIQ_RPC_URL
# Web: NEXT_PUBLIC_API_URL

# Initialize database constraints
bun run db:init

# Start everything
bun run dev
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEO4J_URI` | ✅ | — | Neo4j connection URI |
| `NEO4J_USER` | — | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | ✅ | — | Neo4j password |
| `NEO4J_VOLUME_NAME` | — | `neo4jdata` | External Docker volume name used by Neo4j |
| `NIMIQ_RPC_URL` | — | `http://localhost:8648` | Nimiq node RPC endpoint |
| `PORT` | — | `3001` | API server port |
| `CORS_ORIGIN` | prod | — | Allowed CORS origin |
| `API_KEY` | prod | — | Required for sensitive API routes from non-main origins |
| `MAIN_ORIGIN_HOSTS` | — | `localhost,nimstalker.com,www.nimstalker.com` | Origins treated as first-party |
| `SENSITIVE_RATE_LIMIT_WINDOW_MS` | — | `60000` | Rate-limit window for sensitive routes |
| `SENSITIVE_RATE_LIMIT_PER_WINDOW` | — | `300` | Non-main-origin limit per window |
| `SENSITIVE_RATE_LIMIT_MAIN_ORIGIN_PER_WINDOW` | — | `100000` | High first-party limit per window |
| `NEXT_PUBLIC_API_URL` | ✅ | — | API URL for the frontend |

---

## 📐 Architecture

```
nim-stalker/
├── apps/
│   ├── api/                   # Elysia REST API (Bun)
│   │   └── src/
│   │       ├── data/          # Address book data
│   │       ├── lib/           # Neo4j driver, config, caching, address utils, security, job-tracker, concurrency
│   │       ├── routes/        # health, address, graph, transaction, jobs, indexer endpoints
│   │       └── services/      # rpc-client, graph, path-finder, subgraph-finder, blockchain-indexer, indexing
│   └── web/                   # Next.js frontend
│       ├── app/               # App Router pages
│       ├── components/        # Graph canvas, controls, sidebar panels
│       ├── lib/               # API client, formatters, layout engine
│       └── store/             # Zustand graph store
├── packages/shared/           # Shared TypeScript types
├── docker-compose.yml         # Development stack (Neo4j + API + Web)
└── docker-compose.prod.yml    # Production stack (+ Nimiq node, genesis-init, optional nginx)
```

**Neo4j Graph Model:**
- `(:Address)` — nodes with id, type, balance, indexStatus, txCount, timestamps
- `[:TRANSACTED_WITH]` — aggregated edges with txCount, totalValue, txHashes array (for dedup)
- `(:Meta)` — singleton node tracking blockchain indexer state (lastProcessedBatch, totalTransactionsIndexed)

---

## 📡 API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/address/:addr` | Get address info |
| `POST` | `/address/:addr/index` | Index an address from the blockchain |
| `GET` | `/transaction/:hash` | Lookup transaction by hash (DB first, then RPC fallback) |
| `POST` | `/graph/expand` | Expand a node's connections |
| `GET` | `/graph/path` | Find shortest path between two addresses |
| `GET` | `/graph/subgraph` | Extract a connected subgraph |
| `GET` | `/graph/nodes` | Get specific nodes by ID |
| `GET` | `/graph/latest-blocks` | Get graph data from the latest blocks |
| `GET` | `/jobs` | List active indexing jobs |
| `WS` | `/jobs/ws` | Real-time job progress via WebSocket |
| `GET` | `/indexer/status` | Blockchain indexer status and backfill progress |

Sensitive-route policy in production:
- `POST /address/:addr/index`
- `GET /graph/subgraph`
- `GET /graph/latest-blocks`

These routes are rate-limited. Requests from main origins (`localhost`, `nimstalker.com`) get a very high limit. Other origins must provide `x-api-key: <API_KEY>`.

Caching behavior:
- API address cache TTL: 5 minutes (`apps/api/src/lib/address-cache.ts`)
- Web API client in-memory endpoint TTLs: 2s to 60s depending on endpoint (`apps/web/lib/api.ts`)

---

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

---

## 🧪 Testing

```bash
bun run test        # Run all tests with coverage
bun run lint        # Lint everything
```

---

<p align="center">
  <em>Built with ✦ pink sparkles and mass surveillance energy ✦</em>
</p>
