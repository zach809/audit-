export type AuditStatus = "Pending" | "On Time" | "Late" | "Missing" | "N/A" | "Unknown";
export type OverallStatus = "Pass" | "Pending" | "Late" | "Flag" | "Review";

export type StepCode =
  | "SETUP_WELCOME"
  | "SETUP_ATTY_CALL"
  | "SETUP_COURT_DATE"
  | "CLIENT_CONTACT"
  | "APPEARANCE_FILING"
  | "COURT_RESULTS"
  | "POST_COURT_CALL"
  | "CLIENT_FOLLOWUP";

export type EvidenceSource = "Communication" | "Calendar" | "Note" | "Activity" | "System";

export type AuditItemResult = {
  stepCode: StepCode;
  status: AuditStatus;
  operationalState: string;
  deadlineAt: Date | null;
  correctiveDeadlineAt: Date | null;
  evidenceAt: Date | null;
  evidenceSource: EvidenceSource | null;
  evidenceRefId: string | null;
  evidenceUrl: string | null;
  reasonCode: string | null;
};

export type ClioMatter = {
  id: number;
  number?: number | string | null;
  display_number?: string | null;
  status?: string | null;
  created_at: string;
  client?: {
    id?: number;
    first_name?: string | null;
    last_name?: string | null;
    name?: string | null;
  } | null;
  responsible_attorney?: {
    id?: number;
    name?: string | null;
  } | null;
};

export type ClioCommunication = {
  id: number;
  subject?: string | null;
  type?: string | null;
  date?: string | null;
  created_at?: string | null;
  received_at?: string | null;
  external_properties?: Array<{ name?: string | null; value?: string | null }>;
  user?: { id?: number; name?: string | null } | null;
  senders?: Array<{ id?: number; name?: string | null; type?: string | null }>;
  receivers?: Array<{ id?: number; name?: string | null; type?: string | null }>;
};

export type ClioCalendarEntry = {
  id: number;
  summary?: string | null;
  description?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  created_at?: string | null;
  all_day?: boolean | null;
  calendar_owner?: { id?: number; name?: string | null } | null;
  calendar_entry_event_type?: { id?: number; name?: string | null } | null;
};

export type ClioNote = {
  id: number;
  subject?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  author?: { id?: number; name?: string | null } | null;
};

export type MatterRecord = {
  matter_id: string;
  matter_number: string;
  matter_status: string;
  client_id: string | null;
  client_first_name: string;
  client_last_name: string;
  responsible_attorney_id: string | null;
  responsible_attorney_name: string;
  matter_created_at: Date;
  effective_intake_at: Date;
  last_court_date: Date | null;
  next_court_date: Date | null;
  overall_status: OverallStatus;
  last_audited_at: Date | null;
};
