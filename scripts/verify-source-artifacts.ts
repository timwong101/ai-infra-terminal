import { verifyArtifactIntegrityBatch } from "@/lib/artifacts/service";
import { assertArtifactStorageReady } from "@/lib/artifacts/storage";

assertArtifactStorageReady({ durable: process.env.ARTIFACT_STORAGE_REQUIRED === "1" });
const limit = Math.max(1, Math.min(500, Number(process.argv[2]) || 25));
const result = await verifyArtifactIntegrityBatch(limit);
console.log(`Verified ${result.verified}/${result.checked} archived source artifacts; ${result.corrupt} failed integrity checks.`);
if (result.corrupt) process.exitCode = 1;
