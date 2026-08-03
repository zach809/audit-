export type TemplateCategory = "welcome" | "appearance" | "courtResults" | "courtReminder";

export type TemplateRegistryEntry = {
  category: TemplateCategory;
  label: string;
  purpose: string;
  clioTab: "communications";
  subjects: string[];
};

export const TEMPLATE_REGISTRY: TemplateRegistryEntry[] = [
  {
    category: "welcome",
    label: "Welcome Letter",
    purpose: "New-matter welcome email proof.",
    clioTab: "communications",
    subjects: [
      "Welcome letter",
      "Welcome letter - English",
      "Welcome letter - Spanish",
      "Welcome to Hirsch Law Group",
      "Carta de bienvenida",
      "Bienvenido a Hirsch Law Group",
      "Bienvenida a Hirsch Law Group",
    ],
  },
  {
    category: "appearance",
    label: "Appearance Filed",
    purpose: "Appearance filing notification proof.",
    clioTab: "communications",
    subjects: [
      "Court Appearance Has Been Filed Notification",
      "Notificacion de Presentacion en la Corte",
      "Notificación de Presentación en la Corte",
      "Appearance filing notification",
      "Appearance filed notification",
      "Notice of appearance",
    ],
  },
  {
    category: "courtResults",
    label: "Court Results",
    purpose: "Court result email proof after court.",
    clioTab: "communications",
    subjects: [
      "Court Result and Next Court Date",
      "Court Result MM/DD/YR || Next Court Date MM/DD/YR",
      "Final Court Result - Your Representation has Ended",
      "Resultado del juicio y proxima fecha de audiencia",
      "Resultado del juicio y próxima fecha de audiencia",
      "Resultado final del caso: Su representacion ha terminado",
      "Resultado final del caso: Su representación ha terminado",
    ],
  },
  {
    category: "courtReminder",
    label: "Court Reminder Email",
    purpose: "Pre-court reminder email proof due before court.",
    clioTab: "communications",
    subjects: [
      "In-Person Court Reminder",
      "Recordatorio de audiencia presencial",
      "Recordatorio e instrucciones para la audiencia por Zoom manana DD/MM/YR",
      "Recordatorio e instrucciones para la audiencia por Zoom manana",
      "Recordatorio e instrucciones para la audiencia por Zoom",
      "Recordatorio e instrucciones para la audiencia por Zoom mañana DD/MM/YR",
      "Zoom Instructions for Your Court Hearing",
      "Court reminder",
      "Hearing reminder",
    ],
  },
];

export function templateSubjectsFor(category: TemplateCategory): string[] {
  return TEMPLATE_REGISTRY.filter((entry) => entry.category === category).flatMap((entry) => entry.subjects);
}
