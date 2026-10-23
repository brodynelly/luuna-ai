# Patch: Pi project-switch lifecycle and interrupted store initialization

## Metadata

- Type: bug (focused corrective re-plan; lifecycle and regression coverage exceed the approximately 50-line surgical-patch guideline).
- Patches: `specs/feature-component-workbench.md`
- Trigger: Native workbench smoke fails project switching with `PI DISCONNECTED`; source review finds directory-only readiness can accept interrupted initialization.
- Date: 2026-10-22

## Issue

- `src-tauri/src/main.rs:1982-2010` starts and installs a candidate Pi, takes its stdout in `restart_reader`, sets `pi_started = false`, then calls `ensure_pi`. At `main.rs:606`, `ensure_pi` unconditionally starts a second child and overwrites the candidate; dropping its stdin terminates the first candidate. The initial stdout reader's EOF block at approximately line 647 unconditionally marks shared state disconnected and drains pending requests, including requests for the replacement process. `restart_reader` separately has no EOF cleanup. Late old-process events can also reach current shared state.
- `src-tauri/src/components.rs:296-332` treats `.canopy` and `.mulch` directory existence as complete initialization. It can set the metadata marker to initialized even when required stores/config do not exist. `action` at line 360 trusts the marker alone. A crash immediately after mkdir therefore yields false readiness or permits operations against partial data.
- Upstream Beacon `../luuna/components/beacon/src/commands/init.ts:25-52` refuses any existing `.canopy`, then creates `config.yaml`, `.gitignore`, `prompts.jsonl`, `schemas.jsonl`. Atlas `../luuna/components/atlas/src/utils/config.ts:318-351` repairs missing `expertise/` and `mulch.config.yaml` while preserving existing config. Missions `init` must also be treated carefully: with config present it does not reconstruct missing stores; with config missing it writes empty issue/plan/template files. Blind retry can lose data.
- Expected: One Pi child per successful project switch; only its reader may affect its state or requests. Incomplete stores remain partial and are either safely recovered or refused with precise recovery guidance, preserving every existing record.

## Fix

Make candidate installation and reader ownership coherent without changing Pi RPC behavior: reuse the installed candidate for handshake, attach exactly one reader, and bind all reader events/EOF cleanup to the installed child identity or generation. Serialize lifecycle changes and scope pending-request failure to the process being replaced. Kill and reap the owned previous process; preserve normal active-child EOF errors. Avoid a check-then-update race where a stale reader passes an identity test and later changes the new child's state.

Define one complete-store predicate used by status, initialization and actions. Require regular files `.seeds/config.yaml`, `.seeds/issues.jsonl`, `.seeds/plans.jsonl`, `.seeds/templates.jsonl`, `.canopy/config.yaml`, `.canopy/prompts.jsonl`, `.canopy/schemas.jsonl`, `.mulch/mulch.config.yaml`, plus the `.mulch/expertise` directory; maintain existing no-links checks. Recheck after CLI initialization before marking ready.

Recover only provably safe partial states: Atlas may rerun its non-destructive public init; a completely empty owned Beacon directory may be removed using a non-recursive empty-directory operation and recreated through its public init. A nonempty incomplete Beacon or Missions store must remain partial and fail closed with a named recovery instruction; do not overwrite, truncate, recursively delete, silently move aside populated records or fabricate component files. Missing Missions config with existing records must never trigger destructive public init. If implementing automatic recovery for additional states would require broad changes, retain explicit refusal rather than silently discarding data.

## Files to Modify

- `src-tauri/src/main.rs`: `ensure_pi`, `luuna_change_directory`, reader creation/EOF and minimal ownership state; related focused unit tests if practicable.
- `src-tauri/src/components.rs`: single readiness predicate, safe partial retry, action readiness enforcement, focused unit/real CLI tests.
- `test/workbench-native-smoke.mjs`: extend current native switch assertion to repeat switching and prove new Pi requests still succeed.
- `test/fixture-pi.mjs`: only if needed for deterministic process-count/late-event regression evidence.
- `docs/COMPONENT-WORKBENCH.md`: document precise partial-store recovery behavior and updated evidence.

## Step by Step Tasks

1. Fix Pi startup/candidate reuse so a switch performs one spawn and one reader attachment followed by handshake on that same installed child. Retain stream/busy guards, invalid-directory behavior and current project isolation lock. Do not change provider setup or Pi protocol.
2. Bind reader response/event processing and EOF teardown to child generation/identity. Retiring an old child must not clear new requests, mark the new session disconnected, append old events or stop the new reader. Make active-child EOF still report disconnect and settle its pending requests. Reap replaced children and avoid lock-order deadlocks during kill/wait/reader shutdown.
3. Replace directory-only initialization readiness with the shared required-artifact predicate. Use it in `status`, after `initialize`, and before `action`; missing artifacts must yield partial/not-ready even when the ownership marker says initialized.
4. Add bounded safe partial initialization recovery described above. Verify ownership/link rules first, preserve populated stores exactly, and mark initialized only after every component's artifacts are present. Error text must tell the user whether initialization is retryable or existing data requires recovery.
5. Add regression tests: marker-true plus absent required file is partial and rejects actions; empty Beacon crash state safely retries; Atlas missing config/expertise retries without changing an existing record; incomplete populated Beacon and Missions fail without changing any existing bytes. Repeated initialize on a complete workspace is idempotent.
6. Extend native smoke to switch A -> B -> A, verify `getStats`/a real fixture RPC succeeds after each switch, wait past old-process EOF, and assert no late `PI DISCONNECTED`. Assert records remain separated and returning to A restores its persisted records. If fixture launch counting is added, verify exactly one new Pi process per switch. Native tests remain synthetic-provider evidence.
7. Run focused tests, full repository checks and build, then rerun the native smoke against the freshly rebuilt executable. Inspect results; do not treat an old executable or DOM-only mock as confirmation.

## Validation Commands

- `npm run check`
- `npm test` — include the new readiness/lifecycle regression tests.
- `npm run test:components` — actual pinned CLI tests with new safe-partial cases; no skipped pass.
- `npm run build` — rebuild the exact native release exercised below.
- `npm run test:workbench` — original failing native check, extended with repeated switch/RPC assertions.
- `git diff --check`

## Scope

- Estimated change: approximately 80-160 production/test lines plus replacing duplicated reader logic only if needed to enforce one consistent ownership rule. This is classified as a focused corrective bug re-plan because it exceeds a tiny patch, with no feature expansion or approval checkpoint.
- Risk: medium; Pi lifecycle concurrency and persistent data preservation require the specific native and real-CLI regressions above.
- Unchanged scope: no runtime integration, upstream component edits, broad Pi rewrite, store migrations, unrelated UI redesign or provider-backed claims.
