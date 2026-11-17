# Token Radar — token-radar-01 entry

A token launch radar: it reads the sealed DefiLlama snapshot (`/input/snapshot.json`), ranks
pre-token protocols by an implied token value, and hands in a static dashboard a reader can use —
a ranked board, a detail view per protocol, filters, and a concrete farm plan for every row.

## Run

```
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22.18+ (a newer major counts), standard library only. The program writes
`/output/board.json`, `/output/data.js`, `/output/dashboard/`, `/output/screenshots/` and
`/output/dossier.json`.

## The model (radar-2)

Implied value is calibrated from the snapshot itself, never from a hardcoded list of names:

- Every protocol whose token already trades is a **peer**; a peer's realised multiple is its
  market cap over its TVL.
- A category's multiple is its peers' median multiple, winsorised to a third-to-three-times band
  around the global peer median and averaged with that median weighted by six pseudo-peers, then
  clamped to [0.02, 1.5]. A category with no peers scores at the global median.
- `implied = TVL x category_multiple x growth x maturity x breadth`, where growth clamps the
  seven-day TVL change to [-50, +100] at weight 0.35, maturity runs 0.75 to 1.10 over four years
  of age with no token, and breadth adds 4% per extra chain up to five.

The board covers every watchlist protocol (the floor) plus the 160 largest pre-token protocols
below it. Live-token protocols are set aside and shown at their market caps, never ranked by the
model. Each row carries a six-step farm plan derived from its category, chains, TVL and age —
the dashboard shows the board's own steps verbatim, and recomputes every row's implied value in
the page as a visible check against `board.json`.

An implied value is a claim about what a token would be worth if the protocol's record stayed
as it is. It is not a prediction that a token will be issued, and it is not a price.

## Layout

- `main.ts` — the entrypoint: snapshot in, board + dashboard data + dossier out.
- `lib/model.ts` — the model: peer calibration, implied value, board, farm plans.
- `dashboard/` — the static page (no framework, no network).
- `screenshots/` — the board, a detail view, a filtered view.
- `vendor/makefun-board.ts` — the vendored make.fun dossier library.
