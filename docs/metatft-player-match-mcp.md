# MetaTFT Player Match MCP

This service exposes normalized TFT player match data through four tools:

- `resolve_player`
- `list_matches`
- `get_match`
- `get_player_match_history`

The first release deliberately supports only numeric `#PBE…` and `#NA…`
tag-line subsets. PBE and NA use separate environment, season, cache and feature
flag boundaries. They never fall back to one another or to OP.GG.

## Safety and data contract

Every call resolves a routing context before network access. Explicit environment
values must agree with the tag route. PBE defaults to `set18-pbe`; NA defaults to
the configured live season and filters every returned match by the requested
`tft_set`. A match must also use the expected `PBE1_` or `NA1_` prefix.

`list_matches` accepts a product range of 10 to 20 normalized summaries from one
profile request and defaults to 20. When fewer than 10 valid matches exist, it
returns the actual count rather than inventing records.
It reports `requestedLimit`, `returnedCount`, `availableCount`, and
`observedUpstreamCount` separately. It never expands all match details. Call
`get_match` for one selected match only.

Match detail URLs are treated as untrusted. The adapter only permits HTTPS URLs
on `matches<number>.metatft.com`, requires an exact `/{matchId}.json` path, rejects
query strings/fragments, and disables redirects.

Responses include provenance, environment, season, source fetch time,
`missingFields`, and warnings. Missing data is never inferred.

## Configuration

All routes are disabled by default:

```dotenv
METATFT_PLAYER_MATCH_ENABLED=true
METATFT_PBE_ENABLED=true
METATFT_NA_ENABLED=false
METATFT_PBE_DEFAULT_SEASON=set18-pbe
METATFT_NA_DEFAULT_SEASON=set17-live
PBE_TAG_PATTERN=^PBE[0-9]+$
NA_TAG_PATTERN=^NA[0-9]+$
```

Local stdio MCP:

```powershell
npm run metatft:player-mcp
```

Streamable HTTP sidecar (default `http://127.0.0.1:3010/mcp`):

```powershell
npm run metatft:player-mcp:http
```

Real PBE smoke test:

```powershell
npm run smoke:metatft:player-mcp
```

MetaTFT provides no long-term schema or commercial-use guarantee for this
public-profile response. Keep request volume low, retain caching/rate limiting,
show source attribution to product users, and use the kill switches if the
upstream changes. This MCP does not authorize replacing OP.GG; that requires a
separate live replacement gate.
