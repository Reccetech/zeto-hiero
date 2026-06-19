/**
 * Shared helpers for the tutorial steps that run as SEPARATE processes.
 *
 * The single repo demo (scripts/demo-mvp-testnet.ts) threads the Zeto users and UTXO notes
 * in memory. Here each step is its own script, so we persist:
 *   - each user's BabyJubJub keypair (so a note's Poseidon hash is identical across steps), and
 *   - the spendable notes ({value, salt}) produced by one step and consumed by the next.
 * State lives in examples/walkthrough/.tutorial-state.json (gitignored — it is throwaway demo state).
 */
import * as fs from "fs";
import * as path from "path";
/* eslint-disable @typescript-eslint/no-var-requires */
const { genKeypair, formatPrivKeyForBabyJub } = require("maci-crypto");
/* eslint-enable @typescript-eslint/no-var-requires */
import type { User } from "../../test/lib/zeto-witness";

const STATE_FILE = path.resolve(__dirname, ".tutorial-state.json");

export function readState(): any {
  return fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
}

export function writeState(patch: Record<string, any>) {
  const merged = { ...readState(), ...patch };
  fs.writeFileSync(STATE_FILE, JSON.stringify(merged, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v, 2));
  return merged;
}

/**
 * A Zeto user whose BJJ keypair is stable across steps. First call for a name generates and
 * persists a keypair; later calls (in other step processes) rebuild the same user.
 */
export async function loadUser(name: string, signer: any): Promise<User> {
  const st = readState();
  const saved = st.users?.[name];

  let priv: bigint;
  let pub: bigint[];
  if (saved) {
    priv = BigInt(saved.priv);
    pub = [BigInt(saved.pub[0]), BigInt(saved.pub[1])];
  } else {
    const kp = genKeypair();
    priv = kp.privKey;
    pub = kp.pubKey;
    writeState({
      users: { ...(st.users || {}), [name]: { priv: priv.toString(), pub: [pub[0].toString(), pub[1].toString()] } },
    });
  }

  return {
    signer,
    ethAddress: await signer.getAddress(),
    babyJubPrivateKey: priv,
    babyJubPublicKey: pub,
    formattedPrivateKey: formatPrivKeyForBabyJub(priv),
  };
}

export function requirePool(): string {
  const { poolAddr } = readState();
  if (!poolAddr) throw new Error("No pool in state — run examples/walkthrough/05-deploy-pool.ts first.");
  return poolAddr;
}
