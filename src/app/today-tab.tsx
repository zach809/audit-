import { Owner, StatusBar, WorkStep } from "@/components/work-icons";
import { StatusDistribution } from "@/components/status-bar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { complianceMark } from "@/lib/compliance-mark";
import { statusSegments } from "@/lib/status-distribution";
import "./today.css";

export type TodayWorkRow = {
  matterId: string;
  matterNumber: string;
  clientName: string;
  caseManager: string;
  stepLabel: string;
  status: string;
  actionHref: string;
  actionLabel: string;
};

export type TodayTabProps = {
  rows: TodayWorkRow[];
  firmCount: number;
  kpiScore: number;
  kpiFollowUp: number;
  ongoingFollowUp: number;
  postClosureCount: number;
  mattersHref: string;
  standardsHref: string;
  ongoingHref: string;
  postClosureHref: string;
};

export function TodayTab({
  rows,
  firmCount,
  kpiScore,
  kpiFollowUp,
  ongoingFollowUp,
  postClosureCount,
  mattersHref,
  standardsHref,
  ongoingHref,
  postClosureHref,
}: TodayTabProps) {
  const segments = statusSegments(rows);
  const first = rows[0];

  return (
    <TooltipProvider delayDuration={200}>
      <section className="today-root">
        <section className="today-work">
          <div className="today-work-head">
            <h2>Owed work</h2>
            <p className="today-count">{rows.length} items</p>
          </div>
          {first ? (
            <p className="today-note">
              First up: {first.stepLabel} for {first.clientName}. {first.caseManager} owns it.
            </p>
          ) : null}
          {rows.length ? (
            <div className="today-table-wrap">
              {(() => {
                const counts: Record<string, number> = {};
                for (const r of rows) { const k = complianceMark(r.status).kind; counts[k] = (counts[k] || 0) + 1; }
                return <StatusBar counts={counts} />;
              })()}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Matter</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>What is missing</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const mark = complianceMark(row.status);
                    return (
                      <TableRow
                        data-client-name={row.clientName}
                        data-job-row
                        key={`${row.matterId}-${row.stepLabel}`}
                      >
                        <TableCell>
                          <Badge className={`mark-${mark.kind}`} kind={mark.kind}>
                            {mark.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="today-matter">
                            <strong>{row.clientName}</strong>
                            <small>{row.matterNumber}</small>
                          </div>
                        </TableCell>
                        <TableCell><Owner name={row.caseManager} /></TableCell>
                        <TableCell><WorkStep label={row.stepLabel} /></TableCell>
                        <TableCell>
                          <a className="today-action" data-job-primary href={row.actionHref} rel="noreferrer" target="_blank">
                            {row.actionLabel}
                          </a>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="today-empty">
              <strong>Nothing is owed in this view.</strong>
              <p>Run Audit Batch if this week has not been checked yet.</p>
            </div>
          )}
        </section>

        <StatusDistribution segments={segments} />

        <div className="today-metrics">
          <a className="today-metric" href={mattersHref}>
            <span>Needs review</span>
            <strong>{firmCount}</strong>
            <Tooltip>
              <TooltipTrigger asChild>
                <small>Items needing proof or a timing look</small>
              </TooltipTrigger>
              <TooltipContent>Open Matters to see proof links for each flagged item.</TooltipContent>
            </Tooltip>
          </a>
          <a className="today-metric" href={standardsHref}>
            <span>Standards score</span>
            <strong>{kpiScore}%</strong>
            <Progress label={`Standards score ${kpiScore} percent`} value={kpiScore} />
            <small>{kpiFollowUp} setup item{kpiFollowUp === 1 ? "" : "s"} still need proof</small>
          </a>
          <a className="today-metric" href={ongoingHref}>
            <span>Ongoing cases</span>
            <strong>{ongoingFollowUp}</strong>
            <small>Client contact, weekly check-ins, court reminders</small>
          </a>
          <a className="today-metric" href={postClosureHref}>
            <span>Post-closure</span>
            <strong>{postClosureCount}</strong>
            <small>Closed-matter follow-ups needing review</small>
          </a>
        </div>
      </section>
    </TooltipProvider>
  );
}
