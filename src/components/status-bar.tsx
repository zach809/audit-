import type { StatusSegment } from "@/lib/status-distribution";

export function StatusDistribution({ segments }: { segments: StatusSegment[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  const label = segments.map((segment) => `${segment.label} ${segment.count}`).join(", ");
  return (
    <figure className="today-dist">
      <div aria-label={total ? `Owed work by status: ${label}` : "No owed work"} className="today-dist-bar" role="img">
        {segments.map((segment) => (
          <span
            className={segment.className}
            key={segment.kind}
            style={{ flexGrow: segment.count, flexBasis: 0 }}
            title={`${segment.label}: ${segment.count}`}
          />
        ))}
      </div>
      <figcaption>
        {segments.map((segment) => (
          <span className={`today-legend ${segment.className}`} key={segment.kind}>
            <span className="today-mark" aria-hidden="true" />
            {segment.label}
            <b>{segment.count}</b>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
