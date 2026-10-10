// AG Studio's agents call this once per turn. It forwards the turn to our server route (which holds the
// Claude key and the daily cap) and replays the answer as the stream events Studio's chat expects.
import type { AgAiEvent, AgLlmAdapter, AgLlmRequest, AgLlmResponse } from "ag-studio";

export function spotterAdapter(endpoint = "/api/watchtower/llm"): AgLlmAdapter {
  return {
    executeTurn(request: AgLlmRequest, options) {
      // Started now, so `complete` settles whether or not anyone reads the stream.
      const reply: Promise<AgLlmResponse> = fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request: { ...request, tools: request.tools?.filter((t) => t.kind !== "provided") } }),
        signal: options?.signal,
      }).then(async (res) => {
        const body = (await res.json().catch(() => null)) as { response?: AgLlmResponse; error?: string } | null;
        if (!res.ok || !body?.response) throw new Error(body?.error ?? `Watchtower's assistant answered ${res.status}.`);
        // A refusal arrives as a 200 with status failed: report it, don't show an empty reply.
        if (body.response.status === "failed") throw new Error(body.response.error?.message ?? "The assistant couldn't answer that.");
        return body.response;
      });
      reply.catch(() => {}); // reported once, through `complete`

      async function* events(): AsyncGenerator<AgAiEvent> {
        let response: AgLlmResponse;
        try {
          response = await reply;
        } catch {
          return;
        }
        for (const item of response.output) {
          if (item.type === "message") {
            const text = item.content.map((c) => (c.type === "text" ? c.text : c.refusal)).join("");
            yield { type: "TEXT_MESSAGE_START", messageId: item.id, role: "assistant" };
            yield { type: "TEXT_MESSAGE_CONTENT", messageId: item.id, delta: text };
            yield { type: "TEXT_MESSAGE_END", messageId: item.id };
          } else if (item.type === "function_call") {
            yield { type: "TOOL_CALL_START", toolCallId: item.callId, toolCallName: item.name };
            yield { type: "TOOL_CALL_ARGS", toolCallId: item.callId, delta: item.arguments };
            yield { type: "TOOL_CALL_END", toolCallId: item.callId };
          }
        }
      }
      const it = events();
      return { stream: { [Symbol.asyncIterator]: () => it }, complete: reply };
    },
  };
}
