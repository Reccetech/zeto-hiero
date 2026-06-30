import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

// v1.0 Phase 11 — mainnet launch (GATED, STAGED — does NOT deploy unless every gate is satisfied).
//
// Mainnet deployment of a privacy pool handling real funds is irreversible and outward-facing. This
// script intentionally refuses to run until the three hard gates are met AND the operator passes an
// explicit confirmation env var. It is staged so the launch is a single reviewed, deliberate action.
//
//   GATE 1  Production trusted-setup ceremony complete   (CEREMONY_COMPLETE=true)
//   GATE 2  Third-party security audit clean             (AUDIT_CLEAN=true)
//   GATE 3  hiero-consensus-node on Besu >= 25.3.0        (BESU_VERSION=25.3.0, CVE-2025-30147 fixed)
//   CONFIRM I_UNDERSTAND_THIS_IS_MAINNET=yes
//
// Run (only when authorized): npx hardhat run scripts/mainnet-launch.ts --network hedera_mainnet

function gate(name: string, ok: boolean, detail: string) {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name} — ${detail}`);
  return ok;
}

function semverGte(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return true;
}

async function main() {
  const net = await ethers.provider.getNetwork();
  console.log(`\n=== MAINNET LAUNCH (gated) — chain ${net.chainId} ===\n`);

  const ceremony = process.env.CEREMONY_COMPLETE === "true";
  const audit = process.env.AUDIT_CLEAN === "true";
  const besu = process.env.BESU_VERSION ?? "0.0.0";
  const besuOk = semverGte(besu, "25.3.0");
  const confirm = process.env.I_UNDERSTAND_THIS_IS_MAINNET === "yes";
  const isMainnet = net.chainId === 295n;

  console.log("Launch gates:");
  const g1 = gate("Trusted setup ceremony complete", ceremony, "CEREMONY_COMPLETE");
  const g2 = gate("Security audit clean", audit, "AUDIT_CLEAN");
  const g3 = gate("Besu >= 25.3.0 (CVE-2025-30147)", besuOk, `BESU_VERSION=${besu}`);
  const g4 = gate("Operator confirmation", confirm, "I_UNDERSTAND_THIS_IS_MAINNET=yes");
  const g5 = gate("Connected to Hedera mainnet (295)", isMainnet, `chainId=${net.chainId}`);

  if (!(g1 && g2 && g3 && g4 && g5)) {
    console.log("\n⛔ One or more launch gates not satisfied — refusing to deploy. Nothing was sent.");
    process.exit(1);
  }

  console.log("\n✅ All gates satisfied. Proceeding with mainnet deployment per the operator runbook...");
  // The actual deployment reuses the parameterized deploy in scripts/deploy-pool.ts:
  //   - deploy Poseidon + SmtLib
  //   - deploy the CEREMONY-PRODUCED verifiers (not the *VerifierMVP single-party ones)
  //   - deploy HederaZetoToken (UUPS), setupHTS, setAuthorityKey (from DeRec ceremony)
  //   - set the current OFAC sanctions root, create the HCS audit topic, enroll initial participants
  // Left as an explicit manual runbook step (docs/operator-runbook.md) so launch is deliberate.
  console.log("   See docs/operator-runbook.md §Mainnet for the exact sequence.");
}

main().catch((e) => { console.error(e); process.exit(1); });
