import { authorizeApi } from "@/lib/auth/session";
import {
  getCommitmentLedger,
  reconcileCommitment,
  reviewCommitment,
  reviewCommitmentRevision,
  syncCommitmentCandidates,
} from "@/lib/company-intelligence/commitments/service";
import { boundedText, entityId, parseJsonBody } from "@/lib/http/validation";
import { z } from "zod";

const commitmentCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync"), companyId: entityId.optional() }).strict(),
  z.object({ action: z.literal("reconcile"), id: entityId, outcomeStatus: z.enum(["achieved", "partial", "missed", "not-comparable"]).optional() }).strict(),
]);
const commitmentReviewSchema = z.object({
  entity: z.enum(["commitment", "revision"]),
  id: entityId,
  status: z.enum(["proposed", "accepted", "rejected"]),
  note: boundedText(1_200).optional(),
}).strict();

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    const companyId = new URL(request.url).searchParams.get("company") ?? undefined;
    return Response.json(await getCommitmentLedger(authorized.auth, companyId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load commitments." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const parsed = await parseJsonBody(request, commitmentCommandSchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.data;
    if (body.action === "sync") {
      await syncCommitmentCandidates(authorized.auth);
      return Response.json(await getCommitmentLedger(authorized.auth, body.companyId));
    }
    return Response.json(await reconcileCommitment(body.id, body.outcomeStatus, authorized.auth));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update commitments." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const parsed = await parseJsonBody(request, commitmentReviewSchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.data;
    return Response.json(body.entity === "commitment"
      ? await reviewCommitment(body.id, body.status, body.note, authorized.auth)
      : await reviewCommitmentRevision(body.id, body.status, body.note, authorized.auth));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to review commitment." }, { status: 500 });
  }
}
