# ADR-007: Runtime and Deployment Boundaries

## Status

Accepted

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
- The Next.js web process and long-lived research worker both run on Node.js and use bounded PostgreSQL connection pools.

The web and worker processes deploy as separate Node.js services sharing PostgreSQL, Redis, and S3-compatible object storage. This intentionally favors a conventional, observable runtime over an edge target that cannot host the worker or reuse the same database and queue clients.

## Consequences

- Navigation is read-only and horizontally scalable.
- Worker availability can affect freshness without taking the research UI offline.
- Local Docker mirrors the stateful service boundaries used by CI and the intended deployment.
- Both processes reuse bounded connection pools; deployment sizing must reserve database connections for each replica.
- Explicit App Router segments provide reloadable, bookmarkable workspace and detail URLs while sharing one authenticated terminal shell.
- Heavy workspaces load as independent client chunks; a bundle-budget regression test protects the initial page from absorbing them again.
