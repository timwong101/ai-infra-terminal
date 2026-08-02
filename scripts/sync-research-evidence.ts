import { syncResearchEvidence } from "@/lib/research/evidence";

const result = await syncResearchEvidence();
console.log(`Synchronized ${result.sec} SEC and ${result.ir} IR research passages. Analyst review states were preserved.`);
