import { redirect } from "next/navigation";
import { formatLocal } from "@/lib/business-time";
import {
  getDashboardData,
  STANDARD_CASE_MANAGERS,
  standardsCaseManagerFor,
  type WorkspaceAuditItem,
} from "@/lib/dashboard-data";
import {
  caseManagerPortalIdentity,
  caseManagerPortalOwner,
  normalizeCaseManagerIdentity,
} from "@/lib/case-manager-identity";
import {
  buildCaseManagerActionQueue,
  buildCaseManagerScore,
  CASE_MANAGER_KPIS,
  type CaseManagerActionItem,
  type CaseManagerDeduction,
  type CaseManagerScore,
} from "@/lib/case-manager-score";
import { appConfig } from "@/lib/config";
import { currentCaseManagerName } from "@/lib/session";
import styles from "./case-manager.module.css";

export const dynamic = "force-dynamic";

type WeekSelection = "current" | "past";

const DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function dateKey(value: Date): string {
  return DATE_FORMAT.format(value);
}

function keyToUtcDate(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(key: string, days: number): string {
  const date = keyToUtcDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekBounds(selection: WeekSelection): { from: string; to: string } {
  const today = dateKey(new Date());
  const date = keyToUtcDate(today);
  const day = date.getUTCDay();
  const monday = addDays(today, day === 0 ? -6 : 1 - day);
  const from = selection === "past" ? addDays(monday, -7) : monday;
  return { from, to: addDays(from, 6) };
}

function displayDate(key: string): string {
  const [year, month, day] = key.split("-");
  return `${month}/${day}/${year}`;
}

function clientName(row: WorkspaceAuditItem): string {
  return `${row.client_first_name ?? ""} ${row.client_last_name ?? ""}`.trim() || "Unnamed client";
}

function clioMatterUrl(row: WorkspaceAuditItem): string {
  return `${appConfig().clioBaseUrl}/nc/#/matters/${encodeURIComponent(row.matter_id)}`;
}

function clioAreaUrl(row: WorkspaceAuditItem): string {
  if (row.evidence_url) return row.evidence_url;
  const matter = clioMatterUrl(row);
  if (["SETUP_ATTY_CALL", "SETUP_COURT_DATE", "WEEKLY_CLIENT_CHECKIN"].includes(row.step_code)) {
    return `${matter}/calendar`;
  }
  return `${matter}/communications`;
}

function proofLinks(row: WorkspaceAuditItem): Array<{ label: string; href: string }> {
  const links = [{ label: "Open the right Clio tab", href: clioAreaUrl(row) }];
  if (row.step_code === "SETUP_ATTY_CALL" || row.step_code === "WEEKLY_CLIENT_CHECKIN") {
    links.push({ label: "Open Communications", href: `${clioMatterUrl(row)}/communications` });
  }
  links.push({ label: "Open Matter", href: clioMatterUrl(row) });
  return links.filter((link, index, all) => all.findIndex((candidate) => candidate.href === link.href) === index);
}

function reasonCodeText(row: WorkspaceAuditItem): string {
  if (!row.reason_code) return "CWCA did not save a detailed reason code for this item.";
  return row.reason_code.replaceAll("_", " ").toLowerCase();
}

function workflowLabel(stepCode: string): string {
  return CASE_MANAGER_KPIS.find((kpi) => kpi.code === stepCode)?.label ?? stepCode.replaceAll("_", " ");
}

function nextActionText(stepCode: string): string {
  switch (stepCode) {
    case "SETUP_WELCOME":
      return "Send the approved Welcome Letter and confirm it appears in Clio Communications.";
    case "SETUP_ATTY_CALL":
      return "Schedule or document the initial attorney-client call and link the proof to this matter.";
    case "SETUP_COURT_DATE":
      return "Add the court-date event to the matter calendar before the deadline.";
    case "WEEKLY_CLIENT_CHECKIN":
      return "Complete an outgoing call, email, or SMS before the 10-day contact deadline.";
    default:
      return "Complete the requirement in Clio before the deadline.";
  }
}

function Scorecard({ owner, from, to, score }: { owner: string; from: string; to: string; score: CaseManagerScore }) {
  return (
    <section className={styles.scoreSummary} aria-labelledby="scorecard-title">
      <header className={styles.scoreHeader}>
        <div>
          <p className={styles.eyebrow}>My weekly standards</p>
          <h2 id="scorecard-title">Case Manager: {owner}</h2>
          <p>{displayDate(from)} through {displayDate(to)}</p>
        </div>
        <strong className={score.score >= 90 ? styles.scoreGood : score.score >= 80 ? styles.scoreWatch : styles.scoreLow}>
          {score.score}%
        </strong>
      </header>

      <div className={styles.overallRow}>
        <div className={styles.track} aria-label={`${score.score}% standards score`}>
          <span className={styles.overallFill} style={{ width: `${score.score}%` }} />
        </div>
        <strong>{score.score}%</strong>
      </div>
      <p className={styles.formula}>
        Started at 100 &nbsp;|&nbsp; {score.totalMissing} missing &nbsp;|&nbsp; {score.totalLate} late
        &nbsp;|&nbsp; -{score.totalDeduction} points
      </p>

      <div className={styles.scoreExplanation}>
        <strong>Why your score is {score.score}%</strong>
        {score.totalDeduction ? (
          <p>
            CWCA confirmed {score.totalMissing} missing item{score.totalMissing === 1 ? "" : "s"} at 2 points each and {score.totalLate} late item{score.totalLate === 1 ? "" : "s"} at 0.5 points each. Upcoming work does not reduce your score before its deadline.
          </p>
        ) : (
          <p>No confirmed missing or late work reduced your score. Upcoming deadlines are listed below so you can keep it at 100%.</p>
        )}
      </div>

      <div className={styles.kpiList}>
        {score.kpis.map((kpi) => {
          const rowStatus = kpi.missing
            ? `${kpi.missing} missing`
            : kpi.late
              ? `${kpi.late} late`
              : kpi.expected
                ? "On time"
                : "No items due";
          const fillClass = kpi.missing ? styles.fillMissing : kpi.late ? styles.fillLate : styles.fillGood;
          return (
            <div className={styles.kpiRow} key={kpi.code}>
              <strong>{kpi.label}</strong>
              <div className={styles.track}>
                <span className={fillClass} style={{ width: `${kpi.completionPercent}%` }} />
              </div>
              <span>{kpi.completed}/{kpi.expected} completed</span>
              <span className={kpi.missing ? styles.bad : kpi.late ? styles.watch : styles.good}>{rowStatus}</span>
              <span>-{kpi.deduction}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function UpcomingCard({ item, week }: { item: CaseManagerActionItem; week: WeekSelection }) {
  const row = item.row;
  const urgencyLabel = item.urgency === "due-today" ? "Due today" : item.urgency === "due-soon" ? "Due soon" : "Upcoming";
  return (
    <article className={`${styles.deductionCard} ${styles.upcomingCard}`}>
      <header className={styles.deductionHeader}>
        <div>
          <p className={styles.eyebrow}>{workflowLabel(row.step_code)}</p>
          <h3>{clientName(row)}</h3>
          <p>{row.matter_number || `Matter ${row.matter_id}`}</p>
        </div>
        <strong className={item.urgency === "due-today" ? styles.dueToday : item.urgency === "due-soon" ? styles.dueSoon : styles.upcomingStatus}>
          {urgencyLabel}
        </strong>
      </header>

      <div className={styles.explanation}>
        <strong>What to do</strong>
        <p>{nextActionText(row.step_code)}</p>
      </div>

      <dl className={styles.facts}>
        <div><dt>Attorney</dt><dd>{row.responsible_attorney_name || "Needs assignment"}</dd></div>
        <div><dt>Due</dt><dd>{row.deadline_at ? formatLocal(row.deadline_at) : "No due time saved"}</dd></div>
        <div><dt>Current status</dt><dd>{urgencyLabel}, no deduction yet</dd></div>
        <div><dt>Score impact</dt><dd>0 points before deadline</dd></div>
      </dl>

      <div className={styles.linkRow}>
        {proofLinks(row).map((link, index) => (
          <a className={index === 0 ? styles.primaryLink : styles.secondaryLink} href={link.href} target="_blank" rel="noreferrer" key={link.href}>
            {link.label}
          </a>
        ))}
      </div>

      <div className={styles.actionsSingle}>
        <details>
          <summary>I completed this in Clio</summary>
          <form action="/api/case-manager/complete" method="post">
            <input type="hidden" name="matter_id" value={row.matter_id} />
            <input type="hidden" name="step_code" value={row.step_code} />
            <input type="hidden" name="week" value={week} />
            <label>
              What did you complete?
              <textarea name="note" required placeholder="Tell CWCA where the completed proof appears in Clio." />
            </label>
            <input type="hidden" name="proof_reference" value={clioAreaUrl(row)} />
            <button type="submit">Verify proof with CWCA</button>
            <p>CWCA will recheck Clio and update the status when matching proof is found.</p>
          </form>
        </details>
      </div>
    </article>
  );
}

function DeductionCard({ item, owner, week }: { item: CaseManagerDeduction; owner: string; week: WeekSelection }) {
  const row = item.row;
  return (
    <article className={`${styles.deductionCard} ${item.kind === "missing" ? styles.missingCard : styles.lateCard}`}>
      <header className={styles.deductionHeader}>
        <div>
          <p className={styles.eyebrow}>{item.kind === "missing" ? "Missing proof" : "Completed late"}</p>
          <h3>{clientName(row)}</h3>
          <p>{row.matter_number || `Matter ${row.matter_id}`}</p>
        </div>
        <strong className={item.kind === "missing" ? styles.pointsMissing : styles.pointsLate}>
          -{item.points} {item.points === 1 ? "point" : "points"}
        </strong>
      </header>

      <div className={styles.explanation}>
        <strong>Why this affected your score</strong>
        <p>{item.reason}</p>
      </div>

      <dl className={styles.facts}>
        <div><dt>Attorney</dt><dd>{row.responsible_attorney_name || "Needs assignment"}</dd></div>
        <div><dt>Due</dt><dd>{row.deadline_at ? formatLocal(row.deadline_at) : "No due time saved"}</dd></div>
        <div><dt>Audit detail</dt><dd>{reasonCodeText(row)}</dd></div>
        <div><dt>Proof status</dt><dd>{item.kind === "missing" ? "Proof not confirmed" : "Proof found after deadline"}</dd></div>
      </dl>

      <div className={styles.linkRow}>
        {proofLinks(row).map((link, index) => (
          <a className={index === 0 ? styles.primaryLink : styles.secondaryLink} href={link.href} target="_blank" rel="noreferrer" key={link.href}>
            {link.label}
          </a>
        ))}
      </div>

      <div className={styles.actions}>
        <details>
          <summary>I fixed this in Clio</summary>
          <form action="/api/case-manager/complete" method="post">
            <input type="hidden" name="matter_id" value={row.matter_id} />
            <input type="hidden" name="step_code" value={row.step_code} />
            <input type="hidden" name="week" value={week} />
            <label>
              What did you complete?
              <textarea name="note" required placeholder="Example: I sent the Welcome Letter and confirmed it appears in Communications." />
            </label>
            <input type="hidden" name="proof_reference" value={clioAreaUrl(row)} />
            <button type="submit">Verify proof with CWCA</button>
            <p>CWCA rechecks Clio. The deduction clears only when matching proof is found.</p>
          </form>
        </details>

        <details>
          <summary>This score is incorrect</summary>
          <form action="/api/metrics/exclusion" method="post">
            <input type="hidden" name="action" value="request" />
            <input type="hidden" name="matter_id" value={row.matter_id} />
            <input type="hidden" name="cmname" value={owner} />
            <input type="hidden" name="window" value={week === "past" ? "past-week" : "this-week"} />
            <input type="hidden" name="week" value={week} />
            <label>
              Why should an admin review this deduction?
              <textarea name="reason" required placeholder="Explain where the proof is or why this standard does not apply." />
            </label>
            <button type="submit" className={styles.reviewButton}>Request admin review</button>
            <p>A pending review is protected from scoring while the admin verifies it.</p>
          </form>
        </details>
      </div>
    </article>
  );
}

export default async function CaseManagerPortalPage({
  searchParams,
}: {
  searchParams: { owner?: string; week?: string; cm?: string; message?: string };
}) {
  const login = currentCaseManagerName();
  if (!login) redirect("/case-manager/login");

  const identity = caseManagerPortalIdentity(login);
  const owner = caseManagerPortalOwner(login, searchParams.owner);
  if (!owner) redirect("/case-manager/login?error=account");
  const week: WeekSelection = searchParams.week === "past" ? "past" : "current";
  const { from, to } = weekBounds(week);
  const dashboard = await getDashboardData({});

  // Ownership is enforced on the server. A CM cannot change this by editing the URL.
  const ownerRows = dashboard.workspaceItems.filter(
    (row) => normalizeCaseManagerIdentity(standardsCaseManagerFor(row)) === normalizeCaseManagerIdentity(owner),
  );
  const score = buildCaseManagerScore(ownerRows, { from, to });
  const actionQueue = buildCaseManagerActionQueue(ownerRows, { horizonDays: 7 });
  const notice = searchParams.message ? decodeURIComponent(String(searchParams.message)) : "";

  return (
    <main className={styles.page}>
      <header className={styles.portalHeader}>
        <div>
          <p className={styles.eyebrow}>CWCA case manager portal</p>
          <h1>My Standards &amp; Follow-Up</h1>
          <p>See exactly why your score changed, fix the item in Clio, and ask CWCA to verify the proof.</p>
        </div>
        <div className={styles.account}>
          <span>{login}</span>
          <form action="/api/case-manager/logout" method="post"><button type="submit">Log out</button></form>
        </div>
      </header>

      {identity.isAdmin ? (
        <form className={styles.adminPicker} method="get">
          <label>
            View case manager
            <select name="owner" defaultValue={owner}>
              {STANDARD_CASE_MANAGERS.map((name) => <option value={name} key={name}>{name}</option>)}
            </select>
          </label>
          <input type="hidden" name="week" value={week} />
          <button type="submit">Open scorecard</button>
        </form>
      ) : null}

      <nav className={styles.weekNav} aria-label="Scorecard week">
        <a className={week === "current" ? styles.activeWeek : ""} href={`/case-manager?week=current${identity.isAdmin ? `&owner=${encodeURIComponent(owner)}` : ""}`}>This Week</a>
        <a className={week === "past" ? styles.activeWeek : ""} href={`/case-manager?week=past${identity.isAdmin ? `&owner=${encodeURIComponent(owner)}` : ""}`}>Past Week</a>
      </nav>

      {notice ? <div className={searchParams.cm === "cleared" ? styles.successNotice : styles.notice}>{notice}</div> : null}

      <section className={styles.cmCard} aria-label={`${owner} standards card`}>
        <Scorecard owner={owner} from={from} to={to} score={score} />

        <section className={styles.cardSection} aria-labelledby="deductions-title">
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Why points were deducted</p>
              <h2 id="deductions-title">Score details</h2>
              <p>Each item names the client, explains the deduction, and opens the correct Clio area.</p>
            </div>
            <strong>{score.deductions.length} deduction{score.deductions.length === 1 ? "" : "s"}</strong>
          </header>

          {score.deductions.length ? (
            <div className={styles.cardList}>
              {score.deductions.map((item) => (
                <DeductionCard item={item} owner={owner} week={week} key={`${item.row.matter_id}:${item.row.step_code}:${item.kind}`} />
              ))}
            </div>
          ) : (
            <div className={styles.allClear}>
              <strong>No deductions for this week.</strong>
              <p>There are no confirmed missing or late items affecting {owner}&apos;s score.</p>
            </div>
          )}
        </section>

        <section className={styles.cardSection} aria-labelledby="upcoming-title">
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Protect your score</p>
              <h2 id="upcoming-title">Due now and coming up</h2>
              <p>Incomplete requirements due within seven days. These items do not deduct points before their deadlines.</p>
            </div>
            <strong>{actionQueue.length} upcoming</strong>
          </header>

          {actionQueue.length ? (
            <div className={styles.cardList}>
              {actionQueue.map((item) => (
                <UpcomingCard item={item} week={week} key={`${item.row.matter_id}:${item.row.step_code}`} />
              ))}
            </div>
          ) : (
            <div className={styles.allClear}>
              <strong>Nothing is due in the next seven days.</strong>
              <p>CWCA did not find any incomplete KPI requirements approaching their deadline.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
