import { authorizeApi } from "@/lib/auth/session";
import {
  getCommitmentLedger,
  reconcileCommitment,
  reviewCommitment,
  reviewCommitmentRevision,
  syncCommitmentCandidates,
} from "@/lib/company-intelligence/commitments/service";
import type { CommitmentOutcomeStatus, CommitmentReviewStatus } from "@/lib/company-intelligence/commitments/types";

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
    const body = await request.json() as { action?: string; id?: string; companyId?: string; outcomeStatus?: CommitmentOutcomeStatus };
    if (body.action === "sync") {
      await syncCommitmentCandidates(authorized.auth);
      return Response.json(await getCommitmentLedger(authorized.auth, body.companyId));
    }
    if (body.action === "reconcile" && body.id) return Response.json(await reconcileCommitment(body.id, body.outcomeStatus, authorized.auth));
    return Response.json({ error: "A valid commitments action is required." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update commitments." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const body = await request.json() as { entity?: "commitment" | "revision"; id?: string; status?: CommitmentReviewStatus; note?: string };
    if (!body.id || !body.entity || !body.status || !["proposed", "accepted", "rejected"].includes(body.status)) {
      return Response.json({ error: "An entity, id, and valid review status are required." }, { status: 400 });
    }
    return Response.json(body.entity === "commitment"
      ? await reviewCommitment(body.id, body.status, body.note, authorized.auth)
      : await reviewCommitmentRevision(body.id, body.status, body.note, authorized.auth));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to review commitment." }, { status: 500 });
  }
}
