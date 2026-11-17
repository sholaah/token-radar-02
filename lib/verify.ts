// An independent check of a finished board against the snapshot it claims to score.
//
// main.ts refuses a board its own gate rejects, but a reader holding only board.json and the
// snapshot has no way to tell whether the numbers in the file are the model's numbers or a
// hand-edited copy. This module is that way: it re-derives the board from the snapshot with the
// model in lib/model.ts and compares the two row by row, field by field, so any drift between
// the file and the model is named, not suspected. Run it through the entrypoint:
//
//   node main.ts --verify <board.json> --input <snapshot.json>
//
// It exits 0 when the board is exactly the model's board, and 1 with one line per problem when
// it is not. It reads files and writes nothing.

import { boardIssue, buildBoard, parseSnapshot, type BoardRow, type Snapshot } from './model.ts';

/** The outcome of a verification: whether the board matched, and every problem found. */
export interface VerifyReport {
  ok: boolean;
  rows_checked: number;
  watchlist_covered: number;
  watchlist_size: number;
  problems: string[];
}

/** Parse a board file's text into rows, or explain why it is not a board at all. */
function parseBoard(text: string): { rows: BoardRow[] } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: 'board.json is not JSON' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: 'board.json is not a JSON object' };
  const rows = (raw as Record<string, unknown>).rows;
  if (!Array.isArray(rows)) return { error: 'board.json has no rows array' };
  return { rows: rows as BoardRow[] };
}

/** The fields two rows must agree on for the file to be the model's board. */
function rowProblems(given: BoardRow, expected: BoardRow): string[] {
  const problems: string[] = [];
  const at = `row ${expected.rank} (${expected.slug})`;
  if (given.slug !== expected.slug) return [`${at}: the file has ${given.slug ?? 'no slug'} in this rank`];
  if (given.rank !== expected.rank) problems.push(`${at}: rank is ${given.rank}`);
  if (given.implied_value_usd !== expected.implied_value_usd) {
    problems.push(`${at}: implied value is ${given.implied_value_usd}, the model computes ${expected.implied_value_usd}`);
  }
  if (given.tvl_usd !== expected.tvl_usd) problems.push(`${at}: TVL is ${given.tvl_usd}, the snapshot says ${expected.tvl_usd}`);
  if (given.token_status !== 'pre-token') problems.push(`${at}: token_status is ${given.token_status}, not pre-token`);
  const givenSteps = Array.isArray(given.farm_steps) ? given.farm_steps : [];
  if (givenSteps.length !== expected.farm_steps.length) {
    problems.push(`${at}: ${givenSteps.length} farm steps, the model writes ${expected.farm_steps.length}`);
  } else {
    for (let i = 0; i < givenSteps.length; i++) {
      if (givenSteps[i] !== expected.farm_steps[i]) problems.push(`${at}: farm step ${i + 1} differs from the model's step`);
    }
  }
  const gm = given.model;
  const em = expected.model;
  if (gm === undefined || gm === null) {
    problems.push(`${at}: no model breakdown recorded`);
  } else {
    if (gm.category_multiple !== em.category_multiple) problems.push(`${at}: category multiple is ${gm.category_multiple}, the model uses ${em.category_multiple}`);
    if (gm.growth_multiplier !== em.growth_multiplier) problems.push(`${at}: growth multiplier is ${gm.growth_multiplier}, the model uses ${em.growth_multiplier}`);
    if (gm.maturity_multiplier !== em.maturity_multiplier) problems.push(`${at}: maturity multiplier is ${gm.maturity_multiplier}, the model uses ${em.maturity_multiplier}`);
    if (gm.breadth_multiplier !== em.breadth_multiplier) problems.push(`${at}: breadth multiplier is ${gm.breadth_multiplier}, the model uses ${em.breadth_multiplier}`);
  }
  return problems;
}

/**
 * Verify a board file's text against a snapshot's text. The gate's own rules run first (coverage,
 * ranks, order, step shapes); then the board is rebuilt from the snapshot and compared in full.
 */
export function verifyBoard(boardText: string, snapshotText: string): VerifyReport {
  const snapshot: Snapshot = parseSnapshot(snapshotText);
  const parsed = parseBoard(boardText);
  if ('error' in parsed) {
    return { ok: false, rows_checked: 0, watchlist_covered: 0, watchlist_size: snapshot.watchlist.length, problems: [parsed.error] };
  }
  const given = parsed.rows;
  const problems: string[] = [];
  const gate = boardIssue(given, snapshot);
  if (gate !== null) problems.push(`gate: ${gate}`);
  const expected = buildBoard(snapshot);
  if (given.length !== expected.length) {
    problems.push(`the file holds ${given.length} rows, the model scores ${expected.length}`);
  }
  const byRank = new Map(given.map((r) => [r.rank, r]));
  let checked = 0;
  for (const want of expected) {
    const got = byRank.get(want.rank);
    if (got === undefined) {
      problems.push(`row ${want.rank} (${want.slug}) is missing from the file`);
      continue;
    }
    checked++;
    problems.push(...rowProblems(got, want));
    if (problems.length > 25) break;
  }
  const covered = snapshot.watchlist.filter((s) => given.some((r) => r.slug === s)).length;
  return {
    ok: problems.length === 0,
    rows_checked: checked,
    watchlist_covered: covered,
    watchlist_size: snapshot.watchlist.length,
    problems,
  };
}

/**
 * Verify the dashboard's data.js against a board: the page recomputes nothing it cannot check,
 * so the file it reads must carry the board's own rows — same order, same implied values, and
 * the farm steps character for character. Returns one problem per drift, empty when it agrees.
 */
export function verifyDataScript(dataText: string, board: BoardRow[]): string[] {
  const problems: string[] = [];
  const prefix = 'window.RADAR=';
  if (!dataText.startsWith(prefix)) return ['data.js does not start with the window.RADAR assignment'];
  let data: unknown;
  try {
    data = JSON.parse(dataText.slice(prefix.length).replace(/;\s*$/, ''));
  } catch {
    return ['data.js does not parse as JSON after the assignment'];
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return ['data.js carries no data object'];
  const rows = (data as Record<string, unknown>).rows;
  if (!Array.isArray(rows)) return ['data.js has no rows array'];
  if (rows.length !== board.length) problems.push(`data.js holds ${rows.length} rows, the board holds ${board.length}`);
  const n = Math.min(rows.length, board.length);
  for (let i = 0; i < n; i++) {
    const d = rows[i] as Record<string, unknown>;
    const b = board[i]!;
    if (d.slug !== b.slug) {
      problems.push(`data.js row ${i + 1} is ${String(d.slug)}, the board's row ${i + 1} is ${b.slug}`);
      continue;
    }
    if (d.implied_value_usd !== b.implied_value_usd) {
      problems.push(`data.js row ${b.slug}: implied value ${String(d.implied_value_usd)}, the board carries ${b.implied_value_usd}`);
    }
    const dSteps = Array.isArray(d.farm_steps) ? (d.farm_steps as string[]) : [];
    if (dSteps.length !== b.farm_steps.length || dSteps.some((s, j) => s !== b.farm_steps[j])) {
      problems.push(`data.js row ${b.slug}: the farm plan differs from the board's own steps`);
    }
    if (d.rank !== b.rank) problems.push(`data.js row ${b.slug}: rank ${String(d.rank)}, the board says ${b.rank}`);
  }
  return problems;
}

/** A report as the lines the entrypoint prints: one verdict, then one line per problem. */
export function reportLines(report: VerifyReport): string[] {
  const head = report.ok
    ? `verify: ok, ${report.rows_checked} rows match the model, watchlist ${report.watchlist_covered}/${report.watchlist_size}`
    : `verify: FAILED, ${report.problems.length} problem${report.problems.length === 1 ? '' : 's'}, watchlist ${report.watchlist_covered}/${report.watchlist_size}`;
  return [head, ...report.problems.map((p) => `verify: ${p}`)];
}
