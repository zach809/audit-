export type AiProvider = "anthropic" | "openai";

type GenerateTextOptions = {
  maxOutputTokens: number;
  temperature?: number;
  featureName: string;
};

export class AiConfigurationError extends Error {
  status = 503;
}

function cleanProvider(value: string | undefined): AiProvider | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "anthropic" || normalized === "claude") return "anthropic";
  if (normalized === "openai") return "openai";
  return null;
}

function selectedProvider(): AiProvider {
  const explicit = cleanProvider(process.env.AI_PROVIDER);
  if (explicit) return explicit;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "openai";
}

function anthropicModel(): string {
  const explicit = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL;
  if (explicit) return explicit;
  const sharedModel = process.env.AI_MODEL;
  if (sharedModel?.toLowerCase().includes("claude")) return sharedModel;
  return "claude-haiku-4-5";
}

function openAiModel(): string {
  const explicit = process.env.OPENAI_MODEL;
  if (explicit) return explicit;
  const sharedModel = process.env.AI_MODEL;
  if (sharedModel && !sharedModel.toLowerCase().includes("claude")) return sharedModel;
  return "gpt-4o-mini";
}

function extractOpenAiText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;

  const output = Array.isArray(record.output) ? record.output : [];
  const pieces: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content) ? ((item as Record<string, unknown>).content as unknown[]) : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") pieces.push(text);
    }
  }
  return pieces.join("\n").trim();
}

function extractAnthropicText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  const content = Array.isArray(record.content) ? record.content : [];
  const pieces: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const text = (part as Record<string, unknown>).text;
    if (typeof text === "string") pieces.push(text);
  }
  return pieces.join("\n").trim();
}

export async function generateAiText(prompt: string, options: GenerateTextOptions): Promise<string> {
  const provider = selectedProvider();

  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new AiConfigurationError(`AI is set to Claude, but ANTHROPIC_API_KEY is missing in Vercel.`);
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        model: anthropicModel(),
        max_tokens: options.maxOutputTokens,
        temperature: options.temperature ?? 0.2,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`${options.featureName} failed through Claude. Check ANTHROPIC_API_KEY, ANTHROPIC_MODEL, and Anthropic billing. ${detail}`.slice(0, 700));
    }

    const text = extractAnthropicText(await response.json());
    if (!text) throw new Error("Claude did not return text.");
    return text;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AiConfigurationError(`AI is set to OpenAI, but OPENAI_API_KEY is missing in Vercel.`);
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: openAiModel(),
      input: prompt,
      temperature: options.temperature ?? 0.2,
      max_output_tokens: options.maxOutputTokens,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${options.featureName} failed through OpenAI. Check OPENAI_API_KEY, OPENAI_MODEL, and OpenAI billing. ${detail}`.slice(0, 700));
  }

  const text = extractOpenAiText(await response.json());
  if (!text) throw new Error("OpenAI did not return text.");
  return text;
}
