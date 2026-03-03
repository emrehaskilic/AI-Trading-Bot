## FAZ 1B Results

### Patch/Application Status
- `PATCH.diff` attempted with `git apply --3way` and failed due malformed patch hunks (`corrupt patch at line 69`).
- Manual integration completed using delivered fixed artifacts:
  - `LegacyCalculator_fixed.ts` -> `server/metrics/LegacyCalculator.ts`
  - `CvdCalculator_fixed.ts` -> `server/metrics/CvdCalculator.ts`
  - `RollingWindow_fixed.ts` -> `server/metrics/RollingWindow.ts` (merged with backward-compatible API surface)

### Changed Files
- `server/metrics/LegacyCalculator.ts`
- `server/metrics/CvdCalculator.ts`
- `server/metrics/RollingWindow.ts`
- `server/index.ts`
- `server/backfill/SignalReplay.ts`
- `server/tools/replay_test.ts`
- `docs/CHANGELOG_PHASE_1B.md`

### Determinism Adjustments
- `LegacyCalculator.computeMetrics(ob, referenceTimestamp?)` enabled and call-sites updated to pass event timestamps.
- `CvdCalculator` updated for deterministic timestamp flow and backward-compatible `computeMetrics()` alias.
- `RollingWindow` updated for finite-value sanitization and numerically stable accumulation while preserving existing API used by runtime modules.
- Replay test input generation made deterministic (seeded pseudo-random function, fixed timestamps).

### Build/Run Verification
- Install:
  - `npm install` (root) -> OK
  - `npm install` (`server/`) -> OK
- Build:
  - `npm run build` (`server/`) -> OK
  - `npm run build` (root/frontend) -> OK
- Runtime:
  - Backend `npm run dev` -> `GET http://localhost:8787/api/health` = `200`
  - Frontend `npm run dev -- --port 5174` -> `GET http://localhost:5174` = `200`

### Replay Determinism (3 Runs)
- Command: `node --require ts-node/register tools/replay_test.ts` (run in `server/`)
- Run 1:
  - Replay hash: `1f2450f0`
  - CVD hash series: `-43a2f080, -43a2f080, -43a2f080`
- Run 2:
  - Replay hash: `1f2450f0`
  - CVD hash series: `-43a2f080, -43a2f080, -43a2f080`
- Run 3:
  - Replay hash: `1f2450f0`
  - CVD hash series: `-43a2f080, -43a2f080, -43a2f080`
- Result: hashes are stable across all runs.
- Full sample output path: `server/logs/audit/phase1b_replay_test_output.txt`

### Remaining Risks / TODO
- `PATCH.diff` artifact is structurally inconsistent; future deliveries should provide a clean patch generated via `git format-patch` or `git diff`.
- Determinism cleanup was focused on metric/replay pipeline (`LegacyCalculator`, `CvdCalculator`, `RollingWindow`, replay path). Other runtime modules still intentionally use wall-clock/randomness for live ops scheduling and IDs.
