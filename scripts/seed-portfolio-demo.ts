import { ensureDemoIdentity } from "@/lib/auth/session";
import { ensurePortfolioDemoWorkspace } from "@/lib/demo/portfolio-seed";

const identity = await ensureDemoIdentity();
const result = await ensurePortfolioDemoWorkspace(identity);

console.log("Portfolio demo workspace is ready.");
console.log(JSON.stringify(result, null, 2));
