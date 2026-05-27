export type WorkflowRule = {
  label: string;
  goal: string;
  missing: string;
  action: string;
  late: string;
  unknown: string;
};

export const WORKFLOW_RULES: Record<string, WorkflowRule> = {
  SETUP_WELCOME: {
    label: "Welcome Packet",
    goal: "Send within 2 business hours of a new matter being created.",
    missing: "Welcome packet email/template was not found in Clio communications.",
    action: "Check or send the Welcome Letter / Carta de bienvenida template.",
    late: "Welcome packet was found, but it was completed after the 2-hour setup goal.",
    unknown: "Please recheck this matter before coaching. The app could not confirm the welcome packet from Clio.",
  },
  SETUP_ATTY_CALL: {
    label: "Attorney Call",
    goal: "Schedule within 1 business hour of a new matter being created.",
    missing: "Attorney/client phone call calendar event was not found.",
    action: "Add or verify a Phone Call / Client Call calendar event on the matter.",
    late: "Attorney/client call was scheduled, but it was completed after the 1-hour setup goal.",
    unknown: "Please recheck this matter before coaching. The app could not confirm the attorney call from Clio.",
  },
  SETUP_COURT_DATE: {
    label: "Court Date Added",
    goal: "Add within 2 business hours when the court date is known.",
    missing: "Court date calendar event was not found.",
    action: "Add or verify the court/hearing/plea/status/continuance calendar event on the matter.",
    late: "Court date was added, but it was completed after the 2-hour setup goal.",
    unknown: "Please recheck this matter before coaching. The app could not confirm the court date from Clio.",
  },
  CLIENT_CONTACT: {
    label: "Client Contact",
    goal: "Complete by next business day at 5:00 PM.",
    missing: "Outgoing client contact communication was not found.",
    action: "Check whether an email was sent or a phone call log or communication note was added for the client.",
    late: "Client contact was found, but it was completed after the next-business-day 5:00 PM goal.",
    unknown: "Please recheck this matter before coaching. The app could not confirm client contact from Clio.",
  },
  APPEARANCE_FILING: {
    label: "Appearance Filed",
    goal: "Complete by the second business day at 5:00 PM.",
    missing: "Appearance filing communication/template was not found.",
    action: "Check or send the appearance filing notification template.",
    late: "Appearance filing was found, but it was completed after the second-business-day 5:00 PM goal.",
    unknown: "Please recheck this matter before coaching. The app could not confirm appearance filing from Clio.",
  },
  COURT_RESULTS: {
    label: "Court Results",
    goal: "Complete within 48 hours after court ends.",
    missing: "Court result communication/template was not found after the last court date.",
    action: "Check or send the Court Result / Resultado template.",
    late: "Court result was found, but it was completed after the 48-hour court-results goal.",
    unknown: "Please recheck this matter before coaching. The app could not confirm court results from Clio.",
  },
  POST_COURT_CALL: {
    label: "Post-Court Call",
    goal: "Schedule or complete within 24 hours after court results are received when the case continues.",
    missing: "Post-court attorney/client call calendar event was not found.",
    action: "Schedule or verify a calendar event showing the post-court attorney phone call after court results are received, if the case continues.",
    late: "Post-court call was scheduled, but it was completed after the 24-hour post-result goal.",
    unknown: "Please recheck this matter before coaching. The app could not confirm the post-court call from Clio.",
  },
  CLIENT_FOLLOWUP: {
    label: "Client Follow-Up",
    goal: "Respond before 2 inbound client messages accumulate without a firm response.",
    missing: "Client follow-up risk detected: 2 or more inbound client communications before a firm response.",
    action: "Review the communication thread and respond or coach as needed.",
    late: "Client follow-up was handled late.",
    unknown: "Please recheck this matter before coaching. The app could not confirm follow-up risk from Clio.",
  },
};

export const WORKFLOW_COLUMNS = Object.entries(WORKFLOW_RULES).map(([code, rule]) => [code, rule.label] as [string, string]);

export function workflowLabel(stepCode: string): string {
  return WORKFLOW_RULES[stepCode]?.label ?? stepCode.replaceAll("_", " ");
}
