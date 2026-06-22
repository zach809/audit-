const normalizeMap: Array<[RegExp, string]> = [
  [/á/g, "a"],
  [/é/g, "e"],
  [/í/g, "i"],
  [/ó/g, "o"],
  [/ú/g, "u"],
  [/ñ/g, "n"],
  [/ü/g, "u"],
];

export function normalizeText(value: string | null | undefined): string {
  let text = (value ?? "").toLowerCase();
  for (const [pattern, replacement] of normalizeMap) {
    text = text.replace(pattern, replacement);
  }
  text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return text.replace(/\s+/g, " ").trim();
}

export function haystack(...values: Array<string | null | undefined>): string {
  return normalizeText(values.filter(Boolean).join(" "));
}

export function includesAny(text: string, terms: string[]): boolean {
  const normalized = normalizeText(text);
  const compact = normalized.replace(/[^a-z0-9]+/g, "");
  return terms.some((term) => {
    const normalizedTerm = normalizeText(term);
    const compactTerm = normalizedTerm.replace(/[^a-z0-9]+/g, "");
    return normalized.includes(normalizedTerm) || Boolean(compactTerm && compact.includes(compactTerm));
  });
}

export const TEMPLATE_PATTERNS = {
  welcome: [
    "welcome letter",
    "welcome letter -",
    "welcome letter:",
    "welcome email",
    "welcome packet",
    "welcome to hirsch law group",
    "welcome to hirsch law",
    "welcome to hirsch",
    "carta de bienvenida",
    "carta bienvenida",
    "bienvenido",
    "bienvenida",
    "bienvenido a hirsch law group",
    "bienvenida a hirsch law group",
    "bienvenido a hirsch law",
    "bienvenida a hirsch law",
    "bienvenido a hirsch",
    "bienvenida a hirsch",
  ],
  appearance: [
    "court appearance has been filed notification",
    "court appearance has been filed",
    "court appearance filed notification",
    "court appearance filed",
    "appearance has been filed notification",
    "appearance has been filed",
    "appearance filing notification",
    "appearance filed notification",
    "appearance notification",
    "notificacion de presentacion en la corte",
    "notificacion de presentacion en corte",
    "notificacion de presentacion",
    "notificacion de comparecencia",
    "notificación de presentación en la corte",
    "notice of appearance",
    "appearance notice",
    "notice appearance",
    "presentacion en la corte",
    "presentacion en corte",
    "presentacion ante la corte",
    "comparecencia en corte",
    "filed appearance",
    "appearance filed",
    "filing appearance",
    "e-filed",
    "appearance",
  ],
  courtResults: [
    "court result and next court date",
    "court result and upcoming court date",
    "court results and next court date",
    "final court result - your representation has ended",
    "final court result",
    "your representation has ended",
    "resultado del juicio y proxima fecha de audiencia",
    "resultado del juicio",
    "proxima fecha de audiencia",
    "resultado del juicio y próxima fecha de audiencia",
    "resultado final del caso: su representacion ha terminado",
    "resultado final del caso",
    "su representacion ha terminado",
    "resultado final del caso: su representación ha terminado",
    "court result",
    "court results",
    "next court date",
    "resultado",
    "proxima corte",
  ],
  courtReminder: [
    "in-person court reminder",
    "recordatorio de audiencia presencial",
    "zoom court reminder & instructions",
    "zoom instructions for your court hearing",
    "recordatorio e instrucciones para la audiencia por zoom",
    "recordatorio e instrucciones para la audiencia por zoom manana",
    "recordatorio e instrucciones para la audiencia por zoom mañana",
    "you have court",
  ],
};

export const CALENDAR_PATTERNS = {
  attorneyCall: [
    "phone call",
    "phone-call",
    "phonecall",
    "phonecallclient",
    "telephone call",
    "telephonic call",
    "telephonic",
    "spanish phone call",
    "spanish phonecall",
    "dc-phonecall",
    "dc phonecall",
    "dc phone call",
    "em phone call",
    "em spanish phone call",
    "em-phonecall",
    "em phonecall",
    "em-spanish phone call",
    "phone-client",
    "mf-phone-client",
    "phone client",
    "phone call client",
    "client phone",
    "client phone call",
    "client call",
    "call client",
    "call with client",
    "call w client",
    "call to client",
    "attorney call",
    "attorney client call",
    "attorney/client call",
    "atty call",
    "atty client call",
    "lawyer call",
    "initial call",
    "initial client call",
    "setup call",
    "intake call",
    "llamada",
    "llamada telefonica",
    "llamada con cliente",
    "llamar cliente",
    "telefono",
    "telefonica",
    "spanish call",
    "zoom call",
    "video call",
    "conference call",
    "phone",
    "call",
    "contact client",
    "client contact call",
  ],
  courtEvent: [
    "court",
    "court date",
    "next court",
    "next court date",
    "hearing",
    "court hearing",
    "zoom hearing",
    "arraignment",
    "arraign",
    "pretrial",
    "pre-trial",
    "trial",
    "bench trial",
    "jury trial",
    "status",
    "status conference",
    "plea",
    "plea hearing",
    "plea setting",
    "pre plea",
    "pre-plea",
    "continuance",
    "continued",
    "reset",
    "sentencing",
    "sentence",
    "disposition",
    "docket",
    "docket call",
    "calendar call",
    "motion",
    "motion hearing",
    "bond",
    "bond hearing",
    "detention",
    "revocation",
    "probation",
    "compliance",
    "case management",
    "cmc",
    "conference",
    "setting",
    "court setting",
    "case number",
    "case no",
    "zoom",
    "courtroom",
    "jail",
    "audiencia",
    "corte",
    "declaracion",
    "continuacion",
    "sentencia",
    "mocion",
  ],
  nonCourtEvent: [
    "phone call",
    "phone-call",
    "phonecall",
    "client call",
    "attorney call",
    "post-court call",
    "post court call",
    "consultation",
    "consult",
    "meeting",
    "task",
    "todo",
    "to do",
    "deadline",
    "reminder",
    "email",
    "e-mail",
    "emailed",
    "follow up",
    "follow-up",
    "payment",
    "billing",
    "filing",
    "filed",
    "appearance filed",
    "welcome",
    "correo",
    "intake",
  ],
  emailContact: [
    "email",
    "e-mail",
    "emailed",
    "send email",
    "sent email",
    "email client",
    "client email",
    "email to client",
    "email with client",
    "correo",
    "correo electronico",
    "correo electrónico",
    "enviar correo",
    "email enviado",
    "mensaje al cliente",
  ],
  weeklyClientCheckIn: [
    "weekly client follow-up call",
    "weekly client follow-up",
    "weekly client follow up call",
    "weekly client follow up",
    "weekly follow-up call",
    "weekly follow-up",
    "weekly follow up call",
    "weekly follow up",
    "weekly client check-in",
    "weekly client check in",
    "weekly check-in",
    "weekly check in",
    "weekly courtesy call",
    "client weekly call",
    "weekly call",
    "client courtesy call",
    "courtesy call",
    "llamada semanal",
    "seguimiento semanal",
  ],
};

export function isWelcomeTemplate(text: string): boolean {
  const normalized = normalizeText(text);
  return normalized.startsWith("welcome letter") || includesAny(normalized, TEMPLATE_PATTERNS.welcome);
}

export function isAppearanceTemplate(text: string): boolean {
  const normalized = normalizeText(text);
  return normalized.startsWith("court appearance has been filed notification") ||
    normalized.startsWith("court appearance filed") ||
    normalized.startsWith("appearance has been filed") ||
    normalized.startsWith("notificacion de presentacion") ||
    includesAny(normalized, TEMPLATE_PATTERNS.appearance);
}

export function isCourtResultTemplate(text: string): boolean {
  const normalized = normalizeText(text);
  return normalized.startsWith("court result and next court date") || normalized.startsWith("final court result") || normalized.startsWith("resultado del juicio") || normalized.startsWith("resultado final del caso") || includesAny(normalized, TEMPLATE_PATTERNS.courtResults);
}

export function isCourtReminderTemplate(text: string): boolean {
  const normalized = normalizeText(text);
  return normalized.startsWith("in-person court reminder") || normalized.startsWith("recordatorio de audiencia presencial") || normalized.startsWith("zoom instructions for your court hearing") || normalized.startsWith("recordatorio e instrucciones para la audiencia por zoom") || includesAny(normalized, TEMPLATE_PATTERNS.courtReminder);
}

export function isAttorneyCall(text: string): boolean {
  const normalized = normalizeText(text);
  if (includesAny(normalized, CALENDAR_PATTERNS.weeklyClientCheckIn)) return false;
  if (!includesAny(normalized, CALENDAR_PATTERNS.attorneyCall)) return false;

  const phoneSpecific = includesAny(normalized, [
    "phone",
    "phonecall",
    "telephone",
    "telephonic",
    "telefono",
    "telefonica",
    "llamada",
    "client call",
    "call client",
    "call with client",
    "call w client",
    "call to client",
    "attorney call",
    "atty call",
    "spanish call",
    "zoom call",
    "video call",
    "conference call",
  ]);

  if (isCourtEvent(normalized) && !phoneSpecific) return false;
  return true;
}

export function isCourtEvent(text: string): boolean {
  return includesAny(text, CALENDAR_PATTERNS.courtEvent);
}

export function isNonCourtCalendarEvent(text: string): boolean {
  return includesAny(text, CALENDAR_PATTERNS.nonCourtEvent);
}

export function isPossibleCourtEvent(text: string): boolean {
  return Boolean(normalizeText(text)) && !isAttorneyCall(text) && !isNonCourtCalendarEvent(text);
}

export function isCalendarEmailContact(text: string): boolean {
  const normalized = normalizeText(text);
  if (!includesAny(normalized, CALENDAR_PATTERNS.emailContact)) return false;
  if (isCourtEvent(normalized) || isCourtReminderTemplate(normalized)) return false;
  return true;
}

export function isWeeklyClientCheckIn(text: string): boolean {
  const normalized = normalizeText(text);
  if (!includesAny(normalized, CALENDAR_PATTERNS.weeklyClientCheckIn)) return false;
  if (isCourtEvent(normalized) || isCourtReminderTemplate(normalized)) return false;
  return true;
}

export function isPhoneCallCommunication(text: string): boolean {
  const normalized = normalizeText(text);
  if (includesAny(normalized, ["missed inbound call", "missed call", "inbound sms", "outbound sms", "sms", "text message"])) {
    return false;
  }
  return includesAny(normalized, [
    "phonecommunication",
    "outbound call",
    "inbound call",
    "phone call",
    "telephone call",
    "telephonic call",
    "client call",
    "call client",
    "call with client",
    "call to client",
    "llamada",
  ]);
}
