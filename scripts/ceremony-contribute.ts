import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// v1.0 Phase 10 — trusted setup ceremony contribution wrapper.
//
// IMPORTANT: a production ceremony is a MULTI-PARTY process run by >=10 independent human
// contributors over weeks/months. This script automates ONE contributor's step and records a
// transcript; it does NOT (and cannot) constitute a ceremony on its own. The coordinator collects
// each contributor's output `.zkey` + transcript in sequence. See docs/CEREMONY.md.
//
// Usage (one contributor):
//   ts-node scripts/ceremony-contribute.ts <circuit> <in.zkey> <out.zkey> "<name>" "<entropy>"

function sh(cmd: string): string {
  return execSync(cmd, { encoding: "utf8" });
}

async function main() {
  const [circuit, inZkey, outZkey, name, entropy] = process.argv.slice(2);
  if (!circuit || !inZkey || !outZkey || !name) {
    console.error('Usage: ceremony-contribute.ts <circuit> <in.zkey> <out.zkey> "<name>" "<entropy>"');
    process.exit(1);
  }
  if (!fs.existsSync(inZkey)) throw new Error(`input zkey not found: ${inZkey}`);

  console.log(`Contributing to ${circuit} as "${name}"...`);
  sh(`npx snarkjs zkey contribute "${inZkey}" "${outZkey}" --name="${name}" -v ${entropy ? `-e="${entropy}"` : ""}`);

  // record a transcript line: contributor + sha256 of the produced zkey
  const hash = sh(`npx snarkjs zkey verify-bellman-impossible 2>/dev/null || true`); // placeholder for verify chain
  const sha = require("crypto").createHash("sha256").update(fs.readFileSync(outZkey)).digest("hex");
  const transcript = path.join(path.dirname(outZkey), `${circuit}.transcript.jsonl`);
  fs.appendFileSync(
    transcript,
    JSON.stringify({ circuit, name, zkey: path.basename(outZkey), sha256: sha, at: new Date().toISOString() }) + "\n",
  );
  console.log(`  -> ${outZkey}\n  sha256=${sha}\n  transcript appended: ${transcript}`);
  console.log(`Hand ${outZkey} to the next contributor (or to the coordinator if final).`);
  void hash;
}

main().catch((e) => { console.error(e); process.exit(1); });
