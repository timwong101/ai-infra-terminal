import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { answerResearchAssistantQuestion } from "@/lib/research/research-assistant";
import { authorizeApi } from "@/lib/auth/session";
import { entityId, parseJsonBody, researchFiltersSchema } from "@/lib/http/validation";
import { z } from "zod";

const messagePartSchema = z.object({ type: z.string().max(80), text: z.string().max(12_000).optional() }).passthrough();
const assistantMessageSchema = z.object({
  id: entityId,
  messages: z.array(z.object({ parts: z.array(messagePartSchema).max(80) }).passthrough()).min(1).max(100),
  trigger: z.enum(["submit-message", "regenerate-message"]),
  messageId: entityId.nullish(),
  filters: researchFiltersSchema.optional(),
}).strict();

function textFromMessage(message: { parts: Array<{ type: string; text?: string }> } | undefined) {
  return message?.parts.filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n").trim() ?? "";
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  const { id } = await context.params;
  const parsed = await parseJsonBody(request, assistantMessageSchema);
  if ("response" in parsed) return parsed.response;
  const body = parsed.data;
  const question = textFromMessage(body.messages.at(-1));
  if (!question) return Response.json({ error: "A non-empty research question is required." }, { status: 400 });
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const result = await answerResearchAssistantQuestion(decodeURIComponent(id), question, body.filters ?? {}, authorized.auth);
      const partId = result.id;
      writer.write({ type: "text-start", id: partId });
      writer.write({ type: "text-delta", id: partId, delta: result.markdown });
      writer.write({ type: "text-end", id: partId });
    },
    onError: (error) => error instanceof Error ? error.message : "Unable to answer this question.",
  });
  return createUIMessageStreamResponse({ stream });
}
