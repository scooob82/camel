/** Line diff (LCS) used to compare project versions. */
export type DiffLine = { op: 'ctx' | 'add' | 'del'; text: string } | { op: 'gap'; count: number };

export function diffLines(a: string, b: string, context = 3): DiffLine[] {
  const x = a.split('\n');
  const y = b.split('\n');
  const n = x.length;
  const m = y.length;
  // LCS table (files are small: route YAML)
  const t: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = x[i] === y[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const raw: { op: 'ctx' | 'add' | 'del'; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) (raw.push({ op: 'ctx', text: x[i] }), i++, j++);
    else if (t[i + 1][j] >= t[i][j + 1]) raw.push({ op: 'del', text: x[i++] });
    else raw.push({ op: 'add', text: y[j++] });
  }
  while (i < n) raw.push({ op: 'del', text: x[i++] });
  while (j < m) raw.push({ op: 'add', text: y[j++] });
  // collapse unchanged runs
  const keep = raw.map(() => false);
  raw.forEach((l, k) => {
    if (l.op !== 'ctx') for (let d = -context; d <= context; d++) if (raw[k + d]) keep[k + d] = true;
  });
  const out: DiffLine[] = [];
  let skipped = 0;
  raw.forEach((l, k) => {
    if (keep[k]) {
      if (skipped) out.push({ op: 'gap', count: skipped });
      skipped = 0;
      out.push(l);
    } else skipped++;
  });
  if (skipped) out.push({ op: 'gap', count: skipped });
  return out;
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  return { added: lines.filter((l) => l.op === 'add').length, removed: lines.filter((l) => l.op === 'del').length };
}
