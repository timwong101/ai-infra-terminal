import { authorizeApi } from "@/lib/auth/session";
import {
  downloadSourceArtifact,
  getSourceProvenance,
  promoteSourceExtraction,
  reprocessSourceArtifact,
  verifySourceArtifact,
} from "@/lib/artifacts/service";
import type { ArtifactSourceKind } from "@/lib/artifacts/types";
import { entityId, parseJsonBody } from "@/lib/http/validation";
import { z } from "zod";

const artifactCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify"), sourceKind: z.enum(["sec", "ir"]), sourceDocumentId: entityId }).strict(),
  z.object({ action: z.literal("reprocess"), sourceKind: z.enum(["sec", "ir"]), sourceDocumentId: entityId }).strict(),
  z.object({ action: z.literal("promote"), runId: entityId }).strict(),
]);

function sourceRequest(request: Request) {
  const params = new URL(request.url).searchParams;
  const sourceKind = params.get("source") as ArtifactSourceKind | null;
  const sourceDocumentId = params.get("document")?.trim() ?? "";
  if (!sourceKind || !["sec", "ir"].includes(sourceKind) || !sourceDocumentId || sourceDocumentId.length > 220) {
    throw new Error("A valid source kind and document identifier are required.");
  }
  return { sourceKind, sourceDocumentId, action: params.get("action") };
}
export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    const { sourceKind, sourceDocumentId, action } = sourceRequest(request);
    if (action === "download") {
      const result = await downloadSourceArtifact(sourceKind, sourceDocumentId);
      const extension = result.artifact.contentType.includes("pdf") ? "pdf" : result.artifact.contentType.includes("json") ? "json" : "html";
      return new Response(result.bytes as BodyInit, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Type": result.artifact.contentType,
          "Content-Length": String(result.artifact.byteLength),
          "Content-Disposition": `attachment; filename="source-${result.artifact.contentHash.slice(0, 12)}.${extension}"`,
          "X-Content-SHA256": result.artifact.contentHash,
        },
      });
    }
    return Response.json(await getSourceProvenance(sourceKind, sourceDocumentId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load source provenance." }, { status: 404 });
  }
}

export async function POST(request: Request) {
  const authorized = await authorizeApi(request, "admin");
  if ("response" in authorized) return authorized.response;
  try {
    const parsed = await parseJsonBody(request, artifactCommandSchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.data;
    if (body.action === "promote") return Response.json(await promoteSourceExtraction(body.runId, authorized.auth));
    if (body.action === "verify") return Response.json(await verifySourceArtifact(body.sourceKind, body.sourceDocumentId, authorized.auth));
    return Response.json(await reprocessSourceArtifact(body.sourceKind, body.sourceDocumentId, authorized.auth));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update source provenance." }, { status: 500 });
  }
}
