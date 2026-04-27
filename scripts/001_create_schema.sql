-- Email Audit Database Schema

-- Attorney to Case Manager Assignments table
CREATE TABLE IF NOT EXISTS attorney_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attorney_name TEXT NOT NULL UNIQUE,
  case_manager_name TEXT,
  is_unassigned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Email audits table
CREATE TABLE IF NOT EXISTS email_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id TEXT NOT NULL,
  message_id TEXT,
  email_type TEXT NOT NULL CHECK (email_type IN ('court_results', 'add_to_calendar')),
  subject TEXT NOT NULL,
  client_name TEXT,
  attorney TEXT,
  expected_case_manager TEXT,
  actual_replier TEXT,
  county TEXT,
  case_number TEXT,
  next_court_date TIMESTAMPTZ,
  result_or_onboarding_details TEXT,
  attorney_instructions TEXT,
  case_manager_reply TEXT,
  is_reply_specific BOOLEAN,
  missing_or_unclear TEXT,
  audit_status TEXT NOT NULL CHECK (audit_status IN ('needs_follow_up', 'no_reply', 'wrong_case_manager', 'needs_clarification', 'looks_good')),
  flags TEXT[],
  notes_for_zach TEXT,
  raw_thread_json JSONB,
  audited_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily audit summaries table
CREATE TABLE IF NOT EXISTS audit_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_date DATE NOT NULL UNIQUE,
  total_emails_scanned INTEGER DEFAULT 0,
  needs_follow_up INTEGER DEFAULT 0,
  no_reply INTEGER DEFAULT 0,
  wrong_case_manager INTEGER DEFAULT 0,
  needs_clarification INTEGER DEFAULT 0,
  looks_good INTEGER DEFAULT 0,
  summary_sent BOOLEAN DEFAULT FALSE,
  summary_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Gmail OAuth tokens table (encrypted storage)
CREATE TABLE IF NOT EXISTS gmail_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expiry_date BIGINT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert attorney assignments
INSERT INTO attorney_assignments (attorney_name, case_manager_name, is_unassigned) VALUES
  ('Melanie Fialkowski', 'Ivan Cruz', FALSE),
  ('Michelle McClellan', 'Ronald Luque', FALSE),
  ('Arnold Pula', 'Svetlana Yankova', FALSE),
  ('Luiza Quental', 'Claudia Munoz', FALSE),
  ('Robert Kroeger', 'Edgardo Luque', FALSE),
  ('Andrea Neumann', 'Nathaly Lopez', FALSE),
  ('Alexander Blum', 'Lori Cieslarki', FALSE),
  ('Joseph Weigel', 'Jesus Hernandez', FALSE),
  ('Dan Clifton', 'Jesus Hernandez', FALSE),
  ('Alex Enyart', 'Nathaly Lopez', FALSE),
  ('Elanna Myers', 'Lori Cieslarki', FALSE),
  ('Sara Bozarth', 'Claudia Munoz', FALSE),
  ('Thomas Florek', 'Claudia Munoz', FALSE),
  ('Andrew J. Hanson', 'Alessandra Vargas', FALSE),
  ('Cameron Green', NULL, TRUE),
  ('Priscilla McKoy', NULL, TRUE),
  ('Banks Bostian', NULL, TRUE)
ON CONFLICT (attorney_name) DO NOTHING;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_email_audits_audit_status ON email_audits(audit_status);
CREATE INDEX IF NOT EXISTS idx_email_audits_audited_at ON email_audits(audited_at);
CREATE INDEX IF NOT EXISTS idx_email_audits_email_type ON email_audits(email_type);
CREATE INDEX IF NOT EXISTS idx_email_audits_thread_id ON email_audits(thread_id);
CREATE INDEX IF NOT EXISTS idx_audit_summaries_audit_date ON audit_summaries(audit_date);
