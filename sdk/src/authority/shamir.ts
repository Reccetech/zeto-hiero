// @hiero-privacy/zeto-sdk — Shamir secret sharing over the BN254 scalar field.
//
// DeRec library fallback (per the v0.4 build plan): DeRec was not available as a usable dependency,
// so authority-key custody uses textbook Shamir T-of-N over the prime field the BabyJubJub private
// key lives in. The authority private key (a bigint < FIELD) is split into N shares; any T
// reconstruct it exactly via Lagrange interpolation at x=0; fewer than T reveal nothing.
//
// The cryptographic threshold property is what matters and is unit-tested. Transport encryption of
// each share to its Helper's Hedera key is a pluggable concern (see AuthorityKeyManager).

// BN254 scalar field prime (the field maci-crypto / circom operate in).
export const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export interface Share {
  /** x-coordinate (1-based; never 0 — x=0 is the secret). */
  x: bigint;
  /** y = polynomial(x) mod FIELD. */
  y: bigint;
}

function mod(a: bigint, p = FIELD): bigint {
  return ((a % p) + p) % p;
}

function randField(): bigint {
  // 32 random bytes reduced mod FIELD — adequate for coefficient sampling in this context.
  const bytes = new Uint8Array(32);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("crypto").randomFillSync(bytes);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return mod(v);
}

function modInverse(a: bigint, p = FIELD): bigint {
  // Fermat: a^(p-2) mod p (p prime).
  let result = 1n;
  let base = mod(a, p);
  let exp = p - 2n;
  while (exp > 0n) {
    if (exp & 1n) result = mod(result * base, p);
    base = mod(base * base, p);
    exp >>= 1n;
  }
  return result;
}

/** Split `secret` (< FIELD) into `n` shares with threshold `t` (need any t to reconstruct). */
export function splitSecret(secret: bigint, n: number, t: number): Share[] {
  if (t < 1 || t > n) throw new Error("require 1 <= t <= n");
  if (secret < 0n || secret >= FIELD) throw new Error("secret out of field range");
  // polynomial f(x) = secret + a1 x + ... + a_{t-1} x^{t-1}
  const coeffs = [secret, ...Array.from({ length: t - 1 }, () => randField())];
  const shares: Share[] = [];
  for (let i = 1; i <= n; i++) {
    const x = BigInt(i);
    let y = 0n;
    let xp = 1n;
    for (const c of coeffs) {
      y = mod(y + c * xp);
      xp = mod(xp * x);
    }
    shares.push({ x, y });
  }
  return shares;
}

/** Reconstruct the secret from `t` (or more) shares via Lagrange interpolation at x=0. */
export function reconstruct(shares: Share[]): bigint {
  if (shares.length === 0) throw new Error("no shares");
  let secret = 0n;
  for (let i = 0; i < shares.length; i++) {
    let num = 1n;
    let den = 1n;
    for (let j = 0; j < shares.length; j++) {
      if (i === j) continue;
      num = mod(num * mod(-shares[j].x));
      den = mod(den * mod(shares[i].x - shares[j].x));
    }
    const lagrange = mod(num * modInverse(den));
    secret = mod(secret + shares[i].y * lagrange);
  }
  return secret;
}
