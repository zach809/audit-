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
    "carta de bienvenida",
    "welcome packet",
    "bienvenida",
    "paquete de bienvenida",
  ],
  appearance: [
    "court appearance has been filed notification",
    "notificacion de presentacion en la corte",
    "notice of appearance",
    "filed appearance",
    "e-filed",
    "appearance",
  ],
  courtResults: [
    "court result and next court date",
    "final court result - your representation has ended",
    "resultado del juicio y proxima fecha de audiencia",
    "resultado final del caso: su representacion ha terminado",
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
    "recordatorio e instrucciones para la audiencia por zoom",
    "you have court",
  ],
};

export const CALENDAR_PATTERNS = {
  attorneyCall: [
    "phone call",
    "phone-call",
    "phonecall",
    "spanish phone call",
    "dc-phonecall",
    "em phone call",
    "em spanish phone call",
    "phone-client",
    "mf-phone-client",
    "client call",
    "attorney call",
    "phone",
    "call",
  ],
  courtEvent: [
    "court",
    "hearing",
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
    "follow up",
    "follow-up",
    "payment",
    "billing",
    "filing",
    "filed",
    "appearance filed",
    "welcome",
    "intake",
  ],
};

export function isWelcomeTemplate(text: string): boolean {
  return includesAny(text, TEMPLATE_PATTERNS.welcome);
}

export function isAppearanceTemplate(text: string): boolean {
  return includesAny(text, TEMPLATE_PATTERNS.appearance);
}

export function isCourtResultTemplate(text: string): boolean {
  return includesAny(text, TEMPLATE_PATTERNS.courtResults);
}

export function isAttorneyCall(text: string): boolean {
  return includesAny(text, CALENDAR_PATTERNS.attorneyCall);
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
