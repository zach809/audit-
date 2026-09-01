import { templateSubjectsFor } from "./template-registry";

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

function templateText(value: string): { normalized: string; compact: string } {
  const normalized = normalizeText(value)
    .replace(/[|:/()[\]{}]+/g, " ")
    .replace(/\s*[-–—]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { normalized, compact: normalized.replace(/[^a-z0-9]+/g, "") };
}

export const TEMPLATE_PATTERNS = {
  welcome: [
    ...templateSubjectsFor("welcome"),
    "welcome letter",
    "welcome letter -",
    "welcome letter:",
    "welcome letter english",
    "welcome letter spanish",
    "welcome letter - english",
    "welcome letter - spanish",
    "welcome letter english",
    "welcome letter spanish",
    "welcome email",
    "welcome packet",
    "welcome template",
    "client welcome",
    "new client welcome",
    "welcome to hirsch law group",
    "welcome to hirsch law",
    "welcome to hirsch",
    "carta de bienvenida",
    "carta bienvenida",
    "bienvenido",
    "bienvenida",
    "bienvenidos",
    "bienvenido a hirsch",
    "bienvenida a hirsch",
    "bienvenidos a hirsch",
    "carta bienvenida hirsch",
    "bienvenido a hirsch law group",
    "bienvenida a hirsch law group",
    "bienvenido a hirsch law",
    "bienvenida a hirsch law",
    "bienvenido a hirsch",
    "bienvenida a hirsch",
  ],
  appearance: [
    ...templateSubjectsFor("appearance"),
    "court appearance has been filed notification",
    "court appearance has been filed notification:",
    "court appearance has been filed",
    "court appearance filed notification",
    "court appearance filed notification:",
    "court appearance filed",
    "appearance has been filed notification",
    "appearance has been filed notification:",
    "appearance has been filed",
    "appearance filing notification",
    "appearance filing notification:",
    "appearance filed notification",
    "appearance filed notification:",
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
    ...templateSubjectsFor("courtResults"),
    "court result and next court date",
    "court result mm/dd/yr next court date mm/dd/yr",
    "court result mm/dd/yr || next court date mm/dd/yr",
    "court result next court date",
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
    ...templateSubjectsFor("courtReminder"),
    "in-person court reminder",
    "court reminder",
    "court reminder call",
    "court reminder phone call",
    "hearing reminder",
    "hearing instructions",
    "court instructions",
    "recordatorio de audiencia presencial",
    "recordatorio de audiencia",
    "recordatorio de corte",
    "recordatorio para corte",
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
    "sb-phone call",
    "sb phone call",
    "sb-phonecall",
    "sb phonecall",
    "ic/phonecall",
    "ic-phonecall",
    "ic phonecall",
    "ic phone call",
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
    "weekly client checkin",
    "weekly client checkup",
    "weekly client check up",
    "weekly client phone call",
    "weekly phone call",
    "weekly client touch base",
    "weekly touch base",
    "weekly touchbase",
    "weekly status call",
    "weekly status update",
    "weekly update call",
    "weekly case update call",
    "weekly client care call",
    "check-in call",
    "check in call",
    "checkin call",
    "client check-in call",
    "client check in call",
    "client checkin call",
    "checkup call",
    "phone check-in",
    "phone check in",
    "phone checkin",
    "touch base call",
    "touchbase call",
    "client touch base call",
    "client touchbase call",
    "client status call",
    "case status call",
    "status update call",
    "client update call",
    "case update call",
    "client care call",
    "follow up client",
    "follow-up client",
    "followup with client",
    "follow-up with client",
    "follow up with client",
    "weekly check-in",
    "weekly check in",
    "weekly checkup",
    "weekly check up",
    "weekly courtesy call",
    "weekly client courtesy call",
    "courtesy check-in",
    "courtesy check in",
    "courtesy checkin",
    "client weekly call",
    "client weekly follow up",
    "client weekly follow-up",
    "weekly call",
    "client courtesy call",
    "courtesy call",
    "followup call",
    "follow-up call",
    "follow up call",
    "client followup call",
    "client follow-up call",
    "client follow up call",
    "llamada semanal",
    "llamada semanal al cliente",
    "llamada semanal con cliente",
    "seguimiento semanal",
    "seguimiento semanal al cliente",
    "seguimiento semanal con cliente",
    "llamada de seguimiento",
    "llamada de seguimiento semanal",
    "seguimiento con cliente",
    "llamada de cortesia",
    "llamada de cortesía",
    "llamada de actualizacion",
    "llamada de actualización",
    "llamada para actualizar",
    "actualizacion del caso",
    "actualización del caso",
    "contacto semanal",
    "chequeo semanal",
  ],
};

export function isWelcomeTemplate(text: string): boolean {
  const { normalized, compact } = templateText(text);
  return /\bwelcome\s+letter\b/.test(normalized) ||
    /\bwelcome\s+to\s+hirsch(?:\s+law(?:\s+group)?)?\b/.test(normalized) ||
    /\bcarta\s+de\s+bienvenida\b/.test(normalized) ||
    /\bbienvenid[ao]s?\s+a\s+hirsch(?:\s+law(?:\s+group)?)?\b/.test(normalized) ||
    compact.includes("welcomeletter") ||
    compact.includes("welcometohirsch") ||
    compact.includes("cartadebienvenida") ||
    includesAny(normalized, TEMPLATE_PATTERNS.welcome);
}

export function isAppearanceTemplate(text: string): boolean {
  const { normalized, compact } = templateText(text);
  return /\bcourt\s+appearance\s+has\s+been\s+filed\s+notification\b/.test(normalized) ||
    /\bcourt\s+appearance\s+(?:has\s+been\s+)?filed\b/.test(normalized) ||
    /\bappearance\s+(?:has\s+been\s+)?filed\b/.test(normalized) ||
    /\bappearance\s+filing\s+(?:email|notification|template)\b/.test(normalized) ||
    /\bnotificacion\s+de\s+presentacion\s+en\s+la\s+corte\b/.test(normalized) ||
    /\bpresentacion\s+en\s+la\s+corte\b/.test(normalized) ||
    compact.includes("courtappearancehasbeenfilednotification") ||
    compact.includes("notificaciondepresentacionenlacorte") ||
    includesAny(normalized, TEMPLATE_PATTERNS.appearance);
}

export function isCourtResultTemplate(text: string): boolean {
  const normalized = normalizeText(text);
  return normalized.startsWith("court result and next court date") || normalized.startsWith("final court result") || normalized.startsWith("resultado del juicio") || normalized.startsWith("resultado final del caso") || includesAny(normalized, TEMPLATE_PATTERNS.courtResults);
}

export function isCourtReminderTemplate(text: string): boolean {
  const { normalized, compact } = templateText(text);
  return /\bin\s+person\s+court\s+reminder\b/.test(normalized) ||
    /\brecordatorio\s+de\s+audiencia\s+presencial\b/.test(normalized) ||
    /\bzoom\s+instructions\s+for\s+your\s+court\s+hearing\b/.test(normalized) ||
    /\brecordatorio\s+e\s+instrucciones\s+para\s+la\s+audiencia\s+por\s+zoom\b/.test(normalized) ||
    compact.includes("inpersoncourtreminder") ||
    compact.includes("recordatoriodeaudienciapresencial") ||
    compact.includes("zoominstructionsforyourcourthearing") ||
    includesAny(normalized, TEMPLATE_PATTERNS.courtReminder);
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
  // A recognized check-in title wins over broad court tokens such as "status"
  // and "court" substrings in words like "courtesy" or Spanish "cortesia".
  if (isCourtReminderTemplate(normalized)) return false;
  return true;
}

export function isPhoneCallCommunication(text: string): boolean {
  const normalized = normalizeText(text);
  if (includesAny(normalized, ["missed inbound call", "missed call", "inbound sms", "outbound sms", "sms", "text message"])) {
    return false;
  }
  return includesAny(normalized, [
    "phonecommunication",
    "phone communication",
    "outbound call",
    "outgoing call",
    "inbound call",
    "phone call",
    "telephone call",
    "telephonic call",
    "client call",
    "voice call",
    "call duration",
    "dialpad",
    "completed call",
    "answered call",
    "call client",
    "call with client",
    "call to client",
    "llamada",
  ]);
}

export function isDocumentedCallAttempt(text: string): boolean {
  const normalized = normalizeText(text);
  if (includesAny(normalized, ["missed inbound call", "inbound sms", "outbound sms", "sms", "text message"])) {
    return false;
  }
  return includesAny(normalized, [
    "call attempt",
    "attempted call",
    "attempted to call",
    "tried to call",
    "called no answer",
    "no answer",
    "left voicemail",
    "left voice mail",
    "left a voicemail",
    "left message",
    "voicemail left",
    "voice mail left",
    "lvm",
    "unable to reach",
    "could not reach",
    "no response by phone",
    "intento de llamada",
    "intente llamar",
    "intenté llamar",
    "se intento llamar",
    "se intentó llamar",
    "no contesto",
    "no contestó",
    "sin respuesta",
    "deje mensaje",
    "dejé mensaje",
    "deje voicemail",
    "dejé voicemail",
    "buzon de voz",
    "buzón de voz",
  ]);
}
