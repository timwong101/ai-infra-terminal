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
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date in YYYY-MM-DD format.");
export const researchFiltersSchema = z.object({
  companyIds: z.array(entityId).max(12).optional(),
  topic: boundedText(120).optional(),
  sourceKinds: z.array(z.enum(["sec", "ir"])).max(2).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
}).strict();
