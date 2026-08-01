import { z } from "zod";

export async function parseJsonBody<T extends z.ZodType>(request: Request, schema: T): Promise<{ data: z.output<T> } | { response: Response }> {
  let body: unknown;
  try { body = await request.json(); }
  catch { return { response: Response.json({ error: "Request body must be valid JSON." }, { status: 400 }) }; }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { response: Response.json({ error: "Request validation failed.", issues: z.treeifyError(parsed.error) }, { status: 400 }) };
  }
  return { data: parsed.data };
}

export const entityId = z.string().trim().min(1).max(300);
export const boundedText = (maximum: number) => z.string().trim().max(maximum);
