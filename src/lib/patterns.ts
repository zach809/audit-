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
  return text.replace(/\s+/g, " ").trim();
}

export function haystack(...values: Array<string | null | undefined>): string {
  return normalizeText(values.filter(Boolean).join(" "));
}

export function includesAny(text: string, terms: string[]): boolean {
  const normalized = normalizeText(text);
  return terms.some((term) => normalized.includes(normalizeText(term)));
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
    "phonecall",
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
    "pretrial",
    "trial",
    "status",
    "zoom",
    "courtroom",
    "jail",
    "audiencia",
    "corte",
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
