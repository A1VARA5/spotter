// The backup AI model, used only by the core scam check (src/ai/check.ts) when no Anthropic key can answer.
// Same system prompt, same fenced and sanitized user text, same output schema (strict JSON schema structured
// output). Its answer goes through the same code checks as Claude's: grounding throws out any quote that isn't in
// the message word for word. One try with a short timeout, so a dead backup can't stretch the payment request.
import type { z } from "zod";

export const BACKUP_MODEL = "gpt-5.4-mini";
export const BACKUP_TIMEOUT_MS = 20_000;

export function backupConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.OPENAI_API_KEY?.trim();
}

export async function backupParse<S extends z.ZodType>(opts: {
  system: string;
  user: string;
  schema: S;
  name: string;
  maxOutputTokens: number;
  /** The time the caller has left; never more than BACKUP_TIMEOUT_MS. */
  timeoutMs?: number;
}): Promise<z.infer<S>> {
  const { default: OpenAI } = await import("openai");
  const { zodTextFormat } = await import("openai/helpers/zod");
  const timeout = Math.max(1, Math.min(BACKUP_TIMEOUT_MS, opts.timeoutMs ?? BACKUP_TIMEOUT_MS));
  const client = new OpenAI({ timeout, maxRetries: 0 });
  let res;
  try {
    res = await client.responses.parse({
      model: BACKUP_MODEL,
      instructions: opts.system,
      input: opts.user,
      max_output_tokens: opts.maxOutputTokens,
      reasoning: { effort: "low" },
      text: { format: zodTextFormat(opts.schema, opts.name) },
      store: false,
    });
  } catch (e) {
    // OpenAI's own messages can quote part of the key ("Incorrect API key provided: sk-...abcd"), so only the
    // status and error code travel on into logs and the payment's timeline.
    if (e instanceof OpenAI.APIConnectionTimeoutError) throw new Error(`backup model timed out after ${Math.round(timeout / 1000)} s`);
    if (e instanceof OpenAI.APIConnectionError) throw new Error("backup model couldn't be reached");
    if (e instanceof OpenAI.APIError) throw new Error(`backup model error ${e.status ?? "no response"}${e.code ? ` ${e.code}` : e.type ? ` ${e.type}` : ""}`);
    throw e;
  }
  if (res.status !== "completed" || res.output_parsed == null) {
    throw new Error(`backup model gave no usable output (${res.status}${res.incomplete_details?.reason ? `: ${res.incomplete_details.reason}` : ""})`);
  }
  return res.output_parsed as z.infer<S>;
}
