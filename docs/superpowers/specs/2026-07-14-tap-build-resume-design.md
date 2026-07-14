# Tap build resume (task-level) design

Date: 2026-07-14  
Status: approved (user: 任せる)

## Goal

Failed / cancelled 1st-batch tap builds must be resumable from the next incomplete task without wiping the batch directory, to avoid re-spending Cursor/LLM cost.

## Non-goals

- Mature next-batch improve/repair flow changes
- Resuming mid-prompt inside a single task (failed task is retried whole)
- Multi-batch resume UI beyond batch-1 failed rebuild

## Checkpoint file

Path: `data/brews/<id>/taps/batch-<N>/build-checkpoint.json`

```ts
interface BuildCheckpoint {
  version: 1;
  phase: "generating" | "verifying" | "repairing";
  /** Number of tasks that finished successfully (0 = none). Next task index is completedTasks. */
  completedTasks: number;
  /** null when falling back to single bulk-implement send */
  totalTasks: number | null;
  repairRound: number;
  updatedAt: string; // ISO
}
```

### Write points

- After each successful task send: `completedTasks = i + 1`, `phase: "generating"`
- After all tasks (or bulk implement) succeed: `phase: "verifying"`, `completedTasks = totalTasks ?? 1`
- Entering repair: `phase: "repairing"`, increment `repairRound`
- On batch `succeeded`: delete checkpoint
- On `failed` / `cancelled`: leave checkpoint as-is (last successful boundary)

## Modes

`BuildMode` gains resume for initial batch:

- `{ kind: "initial" }` — wipe via `prepareBatchDir`, start from task 0 (existing)
- `{ kind: "resume" }` — keep batch dir; require checkpoint; start from checkpoint
- existing `{ kind: "improve"; ... }` — unchanged

API: `POST /api/brews/:id/tap/build` body `{ mode?: "resume" | "fresh" }`

- `fresh` → `initial` (wipe)
- `resume` → `resume` (400 if no checkpoint / no dir)
- omitted: if checkpoint exists → resume, else fresh (convenient default for primary button)

## Resume agent prompt

New Cursor session each time. Intro explains:

- Working dir already has partial implementation
- Tasks `1..completedTasks` are done; do not redo or delete them
- Continue from task `completedTasks + 1` (or verify/repair if phase says so)

## UI (tap panel)

When newest batch is `failed` or `cancelled`:

- If checkpoint present: primary **▶ 再開**, secondary **最初から**
- Else: **▶ 再ビルド** (= fresh)

While resuming, progress detail may show e.g. `再開: タスク 4/12`.

## Edge cases

| Case | Behavior |
|------|----------|
| Bulk implement (0 plan tasks) | `totalTasks: null`; after bulk send succeed → verifying; resume at verifying if checkpoint phase is verifying/repairing; if generating with completedTasks 0, re-run bulk with resume intro |
| Failed during task N | `completedTasks` is N-1; resume retries task N |
| Verify exhausted repair rounds | checkpoint at verifying/repairing; resume continues verify/repair loop (respect remaining rounds or restart repair counter from checkpoint.repairRound) |
| Missing dir or checkpoint on resume | 400 |

## Testing

- Unit: checkpoint read/write/clear
- Unit: `runBuild` resume skips completed tasks and does not call `prepareBatchDir` wipe
- Unit/API: build route `mode: "resume" | "fresh"`
