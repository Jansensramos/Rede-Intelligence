import { runProductionPreflight } from "../src/infrastructure/release/production-preflight";
import { productionPreflightCliResult } from "../src/infrastructure/release/production-preflight-cli";

async function main() {
  const result = await runProductionPreflight(process.env);
  const output = productionPreflightCliResult(result);
  console[output.stream](JSON.stringify(output.payload));
  process.exitCode = output.exitCode;
}

void main();
