// Scoring for the scam check eval (scripts/eval-scam-check.mts): each message's label against whether Spotter
// flagged it. A check that failed to run is counted on its own, never as a catch or a pass.
export type Verdict = { label: "scam" | "normal"; flagged: boolean | null };

export type Score = {
  scams: number;
  normals: number;
  caught: number;
  missed: number;
  falseAlarms: number;
  failed: number;
  /** Of the messages flagged, the share that really were scams. Null when nothing was flagged. */
  precision: number | null;
  /** Of the scams that were checked, the share flagged. */
  recall: number | null;
  /** Of the normal messages that were checked, the share flagged. */
  falseAlarmRate: number | null;
};

export function score(vs: readonly Verdict[]): Score {
  const ran = vs.filter((v) => v.flagged !== null);
  const caught = ran.filter((v) => v.label === "scam" && v.flagged).length;
  const missed = ran.filter((v) => v.label === "scam" && !v.flagged).length;
  const falseAlarms = ran.filter((v) => v.label === "normal" && v.flagged).length;
  const okNormals = ran.filter((v) => v.label === "normal").length;
  const ratio = (a: number, b: number) => (b ? a / b : null);
  return {
    scams: vs.filter((v) => v.label === "scam").length,
    normals: vs.filter((v) => v.label === "normal").length,
    caught,
    missed,
    falseAlarms,
    failed: vs.length - ran.length,
    precision: ratio(caught, caught + falseAlarms),
    recall: ratio(caught, caught + missed),
    falseAlarmRate: ratio(falseAlarms, okNormals),
  };
}
