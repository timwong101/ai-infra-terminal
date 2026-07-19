import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import { answerResearchAssistantQuestion, chunkResearchAssistantMarkdown } from "@/lib/research/research-assistant";
import type { ResearchAssistantFilters } from "@/lib/research/types";

function textFromMessage(message: UIMessage | undefined) {
  return message?.parts.filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text").map((part) => part.text).join("\n").trim() ?? "";
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json() as { messages?: UIMessage[]; filters?: Partial<ResearchAssistantFilters> };
  const question = textFromMessage(body.messages?.at(-1));
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const result = await answerResearchAssistantQuestion(decodeURIComponent(id), question, body.filters ?? {});
      const partId = result.id;
      writer.write({ type: "text-start", id: partId });
      for (const chunk of chunkResearchAssistantMarkdown(result.markdown)) writer.write({ type: "text-delta", id: partId, delta: chunk });
      writer.write({ type: "text-end", id: partId });
    },
    onError: (error) => error instanceof Error ? error.message : "Unable to answer this question.",
  });
  return createUIMessageStreamResponse({ stream });
}
