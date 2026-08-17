import {
  CalendarClock, Phone, Gavel, Mail, FileSignature, ClipboardCheck,
  FileText, ShieldCheck, CircleHelp,
} from "lucide-react";

/**
 * A work step is a TYPE, and a type deserves a shape. Eight distinct step
 * labels currently render as eight identical sentences, so a case manager
 * scanning 118 rows has to read every one. An icon lets them scan by form.
 *
 * Matching is on substrings of the real step labels emitted by the audit
 * engine, lowercased — not on an enum we do not own. Anything unmatched gets
 * a neutral mark rather than nothing, so a new step type never renders blank.
 */
const RULES: [RegExp, typeof Phone, string][] = [
  [/court|hearing|trial/i,            Gavel,          "Court"],
  [/call|phone|attorney call/i,       Phone,          "Call"],
  [/check-?in|weekly/i,               CalendarClock,  "Check-in"],
  [/welcome|letter|email|communicat/i, Mail,          "Correspondence"],
  [/sign|retainer|agreement/i,        FileSignature,  "Signature"],
  [/review|audit/i,                   ClipboardCheck, "Review"],
  [/record|document|file/i,           FileText,       "Records"],
  [/polic|coverage|insur/i,           ShieldCheck,    "Coverage"],
];

export function WorkStep({ label }: { label: string }) {
  const hit = RULES.find(([re]) => re.test(label));
  const Icon = hit ? hit[1] : CircleHelp;
  const group = hit ? hit[2] : "Other";
  return (
    <span className="today-step" title={group}>
      <Icon aria-hidden="true" className="today-step-icon" size={15} strokeWidth={1.5} />
      <span>{label}</span>
    </span>
  );
}

/**
 * Ten case managers repeat down the list as bare text. A monogram gives each
 * person a stable visual anchor, so "is this mine?" is answered by shape
 * before it is answered by reading.
 */
export function Owner({ name }: { name: string }) {
  const clean = (name || "").trim();
  if (!clean || /^unassigned$/i.test(clean)) {
    return <span className="today-owner today-owner-none">Unassigned</span>;
  }
  const initials = clean.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <span className="today-owner">
      <span aria-hidden="true" className="today-monogram">{initials}</span>
      <span>{clean}</span>
    </span>
  );
}

/**
 * 118 items split by state, as one stacked bar. This is the only element on
 * the page that answers "how is the firm doing?" without reading a number.
 */
export function StatusBar({ counts }: { counts: Record<string, number> }) {
  const order = ["missing", "late", "not-due", "no-activity", "on-time"] as const;
  const total = order.reduce((n, k) => n + (counts[k] || 0), 0);
  if (!total) return null;
  return (
    <div className="today-dist" role="img"
         aria-label={order.map((k) => `${counts[k] || 0} ${k}`).join(", ")}>
      <div className="today-dist-bar">
        {order.map((k) =>
          counts[k] ? (
            <span className={`today-dist-seg mark-${k}`} key={k}
                  style={{ width: `${((counts[k] || 0) / total) * 100}%` }} />
          ) : null,
        )}
      </div>
      <div className="today-dist-key">
        {order.map((k) =>
          counts[k] ? (
            <span className={`today-dist-item mark-${k}`} key={k}>
              <span className="today-dist-dot" />
              <b>{counts[k]}</b> {k.replace("-", " ")}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}
