# ADR-007: Runtime and Deployment Boundaries

## Status

Accepted for the current portfolio deployment target

## Context

The terminal combines an interactive React application with PostgreSQL, Redis queues, an independent worker, S3-compatible artifact storage, and upstream SEC/IR requests. Running ingestion inside page requests made latency and external traffic depend on user navigation and behaved differently across application instances.

## Decision

- The web process serves authenticated UI and read-oriented APIs.
- PostgreSQL owns durable application state and workspace decisions.
- Redis and BullMQ own durable job dispatch, retry, and dead-letter behavior.
- Independent research workers own upstream refresh, extraction, intelligence rebuilds, and briefings.
- Object storage owns immutable source bytes; PostgreSQL stores their hashes and lineage.
- Company-intelligence replacement runs under a PostgreSQL advisory lock and transaction. External Company Facts requests complete before the transaction starts.
- Global ingestion and parser controls require the admin role. Page loads never initiate upstream refresh or extraction.
- The long-lived Node worker uses a bounded PostgreSQL connection pool. The Cloudflare web runtime opens request-scoped connections because Workers cannot reuse request-bound TCP sockets across requests; a public Cloudflare deployment should put Hyperdrive or another compatible connection proxy in front of PostgreSQL.

`vinext` currently supplies the Next-compatible application runtime and Cloudflare build target. Before public deployment, the web and worker processes must be deployed as separate services sharing PostgreSQL, Redis, and object storage. The worker is not suitable for an edge-only runtime.

## Consequences

- Navigation is read-only and horizontally scalable.
- Worker availability can affect freshness without taking the research UI offline.
- Local Docker mirrors the stateful service boundaries used by CI and the intended deployment.
- Web requests avoid cross-request socket reuse, while worker jobs amortize connections through a process pool.
- A future routing migration can replace the current client shell without changing ingestion ownership.
