export interface PlanTask {
  title: string;
  body: string;
}

/** 05-implementation-plan.md の第2レベル見出し(## )を1タスクとして抽出する */
export function extractTasks(markdown: string): PlanTask[] {
  const lines = markdown.split(/\r?\n/);
  const tasks: PlanTask[] = [];
  let current: PlanTask | null = null;
  for (const line of lines) {
    const m = /^##\s+(.+)$/.exec(line);
    if (m) {
      if (current) tasks.push(current);
      current = { title: m[1].trim(), body: "" };
    } else if (current) {
      current.body += line + "\n";
    }
  }
  if (current) tasks.push(current);
  return tasks.map((t) => ({ ...t, body: t.body.trim() }));
}
