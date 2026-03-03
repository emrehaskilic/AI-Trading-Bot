# Phase 2 - Institutional Risk Engine Hardening

## Scope
- Added an institutional risk engine layer under `server/risk`.
- Integrated risk checks into the orchestrator decision-to-order path.
- Added runtime risk telemetry and API status visibility.
- Added a dedicated simulation suite for FAZ 2 risk scenarios.

## Added Core Components
- `server/risk/RiskStateManager.ts`
- `server/risk/PositionRiskGuard.ts`
- `server/risk/DrawdownRiskGuard.ts`
- `server/risk/ConsecutiveLossGuard.ts`
- `server/risk/MultiSymbolExposureGuard.ts`
- `server/risk/ExecutionRiskGuard.ts`
- `server/risk/KillSwitchManager.ts`
- `server/risk/InstitutionalRiskEngine.ts`

## Integration Changes
- `server/index.ts`
  - Added `InstitutionalRiskEngine` bootstrap with safe defaults.
  - Added pre-trade `canTrade(...)` gate before ENTRY/ADD forwarding.
  - Added rejection logging with guard/state breakdown.
  - Added reduced-risk position sizing propagation via `sizeMultiplier`.
  - Added post-trade sync hooks (`updatePosition`, `recordTradeResult`) from dry-run status.
  - Added heartbeat/latency/price feed updates into kill-switch manager.
  - Added `/api/risk/status`.
  - Added risk summary to `/api/health`.
  - Synced manual `/api/kill-switch` with risk state manager.

## Config Defaults
- Extended `server/.env.example` with `RISK_*` settings.
- All new settings have in-code fallbacks to prevent runtime crashes when env keys are missing.

## Test Additions
- Added `server/test/risk_simulation_test.ts`.
- Added `server/package.json` script:
  - `npm run test:risk-sim`

## Notes
- Original package patch (`PATCH_FAZ_2.diff`) was not directly applicable due patch corruption, so integration was applied manually.
- `DrawdownRiskGuard` now evaluates on each equity update, not only interval ticks.
- `InstitutionalRiskEngine.reset()` now rebuilds guards with a fresh state manager to avoid stale guard references.

