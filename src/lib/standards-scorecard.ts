export type StandardsReportRow = {
  newMatters: number;
  attorneyCall: number;
  welcome: number;
  courtDate: number;
  weeklyCheckIns: number;
};

export type StandardsScorecardStatus = "MET" | "REVIEW" | "NO DATA" | "TRACKED";
export type StandardsScorecardVerdict = "ON TARGET" | "BELOW TARGET" | "NO DATA";

export type StandardsCoreStandard = {
  name: string;
  actual: number;
  required: number | string;
  status: StandardsScorecardStatus;
};

export type StandardsScorecard = {
  owner: string;
  period: { from: string; to: string };
  periodLabel: string;
  targetLabel: string;
  overallCompliance: string;
  targetsMet: string;
  casesHandled: number;
  followUpItems: number;
  weeklyCheckIns: number;
  verdict: StandardsScorecardVerdict;
  coreStandards: [StandardsCoreStandard, StandardsCoreStandard, StandardsCoreStandard, StandardsCoreStandard];
};

const COMPLIANCE_TARGET = 0.9;

function setupStatus(actual: number, required: number): StandardsScorecardStatus {
  if (!required) return "NO DATA";
  return actual >= required ? "MET" : "REVIEW";
}

export function buildStandardsScorecard(
  owner: string,
  rows: StandardsReportRow[],
  period: { from: string; to: string },
): StandardsScorecard {
  const totals = rows.reduce(
    (acc, row) => {
      acc.newMatters += row.newMatters;
      acc.attorneyCall += row.attorneyCall;
      acc.welcome += row.welcome;
      acc.courtDate += row.courtDate;
      acc.weeklyCheckIns += row.weeklyCheckIns;
      return acc;
    },
    { newMatters: 0, attorneyCall: 0, welcome: 0, courtDate: 0, weeklyCheckIns: 0 },
  );
  const requiredSetup = totals.newMatters * 3;
  const completedSetup = totals.attorneyCall + totals.welcome + totals.courtDate;
  const missingSetup = Math.max(0, requiredSetup - completedSetup);
  const overallPercent = requiredSetup ? completedSetup / requiredSetup : 0;
  const overallCompliance = requiredSetup ? `${Math.round(overallPercent * 100)}%` : "No activity";
  const targetsMet = requiredSetup ? `${completedSetup} of ${requiredSetup}` : "0 of 0";
  const verdict: StandardsScorecardVerdict = !requiredSetup
    ? "NO DATA"
    : overallPercent >= COMPLIANCE_TARGET
      ? "ON TARGET"
      : "BELOW TARGET";

  return {
    owner,
    period,
    periodLabel: period.from && period.to ? `${period.from} - ${period.to}` : "Selected week",
    targetLabel: `${Math.round(COMPLIANCE_TARGET * 100)}%`,
    overallCompliance,
    targetsMet,
    casesHandled: totals.newMatters,
    followUpItems: missingSetup,
    weeklyCheckIns: totals.weeklyCheckIns,
    verdict,
    coreStandards: [
      {
        name: "Initial meeting set - Phone call",
        actual: totals.attorneyCall,
        required: totals.newMatters,
        status: setupStatus(totals.attorneyCall, totals.newMatters),
      },
      {
        name: "Welcome letters sent",
        actual: totals.welcome,
        required: totals.newMatters,
        status: setupStatus(totals.welcome, totals.newMatters),
      },
      {
        name: "Court date event made",
        actual: totals.courtDate,
        required: totals.newMatters,
        status: setupStatus(totals.courtDate, totals.newMatters),
      },
      {
        name: "Weekly check-ins completed",
        actual: totals.weeklyCheckIns,
        required: "As due",
        status: totals.weeklyCheckIns ? "TRACKED" : "NO DATA",
      },
    ],
  };
}
