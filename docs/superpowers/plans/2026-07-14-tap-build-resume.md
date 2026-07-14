# Tap Build Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow failed/cancelled tap batch-1 builds to resume from the next incomplete task without wiping the batch folder.

**Architecture:** Persist `build-checkpoint.json` in the batch dir; add `BuildMode` `resume`; API `mode: resume|fresh`; UI primary Resume / secondary Fresh.

**Tech Stack:** Next.js App Router, Vitest, existing `runBuild` / FakeBuildEngine

---

### Task 1: Checkpoint module

**Files:**
- Create: `src/lib/tap/checkpoint.ts`
- Test: `tests/unit/tap-checkpoint.test.ts`

- [ ] Write failing tests for read/write/clear/exists
- [ ] Implement checkpoint helpers
- [ ] Commit

### Task 2: runBuild resume path

**Files:**
- Modify: `src/lib/tap/index.ts`
- Test: `tests/unit/tap.test.ts` (or `tap-resume.test.ts`)

- [ ] Failing test: resume does not delete existing file; skips completed tasks
- [ ] Implement resume branch + checkpoint updates + resume intro prompt
- [ ] Commit

### Task 3: API + UI

**Files:**
- Modify: `src/app/api/brews/[id]/tap/build/route.ts`
- Modify: `src/components/tap-panel.tsx`
- Modify: `tests/unit/api-tap-routes.test.ts`

- [ ] API accepts mode resume/fresh; default prefers resume when checkpoint exists
- [ ] UI buttons Resume / Fresh; detect checkpoint via brew progress or lightweight API field
- [ ] Commit

### Task 4: Verify

- [ ] `npx vitest run` and `npx tsc --noEmit`
- [ ] Push branch
