# How Zeto Works — The Privacy Model Behind the Tutorial

Companion to [`TUTORIAL-Zeto-Hiero-Shielded-Pool.md`](TUTORIAL-Zeto-Hiero-Shielded-Pool.md). The tutorial shows you *how to run* the deposit → transfer → withdraw flow. This doc explains *what Alice and Bob are actually doing in Zeto terms* and *why their transaction stays private*.

We touch the Hedera layer only lightly — just enough to say what ran where. The interesting part is the cryptography, so that's where the depth goes.

---

## The one-paragraph version

Zeto is a **shielded pool**. A real token sits locked in a pool contract, and value moves *inside* the pool as **encrypted notes** instead of visible balances. Alice puts tokens in (a public **deposit**), reshuffles them into new notes addressed to other people (a private **transfer**), and Bob takes his share back out (a public **withdraw**). The entrance and exit are public and auditable; everything in between hides **how much** moved and **between whom**. A zero-knowledge proof makes sure no value is created or destroyed along the way, even though nobody can see the amounts.

---

## What ran on Hedera (the light version)

Three things from the tutorial are the Hedera substrate; we won't go deeper than this:

- **A real HTS token** (`ZUSD-TEST`) — an ordinary fungible token. This is the value being shielded.
- **The pool contract** (`HederaZetoTokenLite`) — a smart contract that custodies that token and enforces the rules below. When you **deposit**, the contract pulls your real tokens in; when you **withdraw**, it sends real tokens back out. Those two are ordinary, *visible* token transfers.
- **Each step is a transaction** recorded on the ledger and viewable on HashScan. The privacy claim is precisely a claim about *what those public records reveal* — which is the rest of this doc.

Everything else here is Zeto, and would work the same on any EVM chain.

---

## Alice and Bob's real identity: their Zeto key

The account Alice uses to pay for transactions is **not** how Zeto knows her. Inside the pool, Alice is identified by a separate **owner key** — a BabyJubJub keypair (a curve chosen because it's cheap to use inside zero-knowledge circuits). Bob has his own. These keys never appear on-chain in the clear. They are what make a note "belong to" someone, and what an observer cannot see.

This separation is the first privacy lever: knowing Alice's *account* tells you nothing about which *notes* she owns in the pool.

---

## The unit of value: a note (commitment)

Inside the pool there are no balances — only **notes**. A note is a small record:

```
note = { value, salt, owner }
```

- **value** — how many tokens the note is worth (e.g. 100).
- **salt** — a large random number, fresh per note.
- **owner** — a Zeto public key (Alice's or Bob's).

What actually gets stored on-chain is never the note itself, only its **commitment** — a hash:

```
commitment = Poseidon(value, salt, ownerPubKey.x, ownerPubKey.y)
```

(`Poseidon` is a hash function designed to be efficient inside ZK circuits.) The commitment is a one-way fingerprint: it pins down the note exactly, but reveals nothing about the value or the owner to anyone looking at the chain. The **salt** is what makes this safe — without it, an observer could guess a small set of likely values and hash them to recognise the note. The salt makes each commitment unguessable and makes two equal-value notes look completely different.

To *spend* a note you must know its three secrets (`value`, `salt`, owner private key). That's the second privacy lever: the chain holds only fingerprints, and only the owner holds the preimage.

---

## The lifecycle, in Zeto terms

### 1. Deposit — Alice enters the pool (public)

Alice hands real tokens to the pool and, in return, the pool records a **new commitment** for a note she owns. In the tutorial she deposits 100, so a note `{value: 100, salt, owner: Alice}` comes into existence and its commitment is stored.

This step is **public on purpose**: the amount (100) and the fact that *Alice* put it in are visible — it's the auditable on-ramp. What's *not* obvious is anything about what she'll do with it next.

### 2. Private transfer — Alice pays Bob (private)

This is the heart of Zeto. Alice wants to send Bob 40 and keep 60. She does **not** edit balances. Instead she:

1. **Spends** her 100-note (names its commitment as an input).
2. **Creates two new output notes**: `{40, salt₂, owner: Bob}` and `{60, salt₃, owner: Alice}`.
3. **Produces a zero-knowledge proof** and submits the transfer.

The chain ends up with: the input note marked spent, two new output commitments, and an encrypted blob (next section). **No amounts appear. Bob's identity does not appear.** An observer sees that *some* note was reshuffled into *two* new anonymous notes — not that it was 40-to-Bob and 60-back-to-Alice.

#### What the zero-knowledge proof proves

Because the amounts are hidden, how does the contract know Alice isn't cheating — e.g. spending a 100-note and minting two 1,000-notes? The proof. Without revealing any of the secret values, it mathematically guarantees:

- **Value is conserved** — inputs total exactly equals outputs total (100 = 40 + 60).
- **Ownership** — the spender actually holds the owner private key for the input note (you can't spend someone else's note).
- **Well-formed notes** — each output commitment is a correct hash of its hidden `(value, salt, owner)`.
- **Honest encryption** — the encrypted blob (below) really does contain the output notes, not junk.

The contract checks this proof and accepts the transfer only if it holds. So the system stays sound — no value is created or destroyed — while every number stays secret. (The proof is generated on Alice's machine; only the small proof is sent on-chain, which is why the *amounts* never leave her device.)

### 3. Note discovery — how Bob finds out he was paid (ECDH)

There's a puzzle: the chain now holds Bob's commitment, but Bob can't spend it unless he learns its secret `value` and `salt` — and Alice chose those. Sending Bob a private message would defeat the point. Zeto solves this by **encrypting the note into the transaction itself**, so the only thing Bob needs is his own private key.

When Alice builds the transfer, inside the proof her software also:

1. **Generates a throwaway ephemeral keypair** `(ephPriv, ephPub)` — brand new for this one transfer.
2. **Derives a shared secret** with Bob: `shared = ephPriv · BobPubKey` (a point-multiplication on the curve — this is **ECDH**, Diffie–Hellman key agreement).
3. **Encrypts Bob's `(value, salt)`** under that shared secret (using a ZK-friendly Poseidon-based cipher), and publishes the resulting ciphertext plus the ephemeral **public** key `ephPub` in the transfer event. `ephPriv` is never published.

Bob (or his wallet) reverses it using a symmetry built into ECDH:

```
ephPriv · BobPubKey   ==   BobPrivKey · ephPub
        ↑ what Alice computed          ↑ what Bob computes
```

Both sides equal the **same shared secret**, but Bob's route requires `BobPrivKey` — which only Bob has. He recomputes the shared secret from his private key and the published `ephPub`, decrypts the ciphertext, and recovers `value = 40` and its `salt`. Now he can reconstruct the full note and prove it's his commitment on-chain. That's the `value=40` line you saw in the tutorial.

A couple of consequences:

- **Only Bob can read it.** Everyone sees the ciphertext and `ephPub`; nobody without `BobPrivKey` can derive the shared secret, so the amount and salt stay secret to all but Bob.
- **Discovery is trustless.** The proof guaranteed the ciphertext genuinely contains the committed note, so Bob can rely on what he decrypts.
- **In the real world Bob doesn't know which note is his in advance** — his wallet *scans* transfer events and simply *tries* to decrypt each one. A note is "his" when the decryption produces a `(value, salt)` whose hash matches an on-chain commitment under his key. (The tutorial shortcut the scan by knowing Bob was the first output.) The fresh ephemeral key per transfer also means repeated payments between the same people don't share any visible key, so they can't be clustered.

### 4. Withdraw — Bob exits the pool (public)

Bob spends his 40-note and the pool sends 40 real tokens back to him. Like the deposit, the **amount is public** — it's the auditable off-ramp. He proves he owns the note (again without revealing the salt or his key), the contract burns the commitment, and real value leaves the pool.

---

## The privacy model: what's hidden, what's visible

| Action | Public / visible | Hidden |
|---|---|---|
| **Deposit** | Alice deposited; the amount (100) | — (it's the public on-ramp) |
| **Transfer** | That a note was spent into 2 new notes; the proof; a ciphertext blob | **The amounts (40 / 60); that Bob is the recipient; the Alice→Bob link** |
| **Withdraw** | Bob withdrew; the amount (40) | — (it's the public off-ramp) |
| **At all times** | Opaque commitments (hashes); spent/unspent markers | Note values, note owners, who holds what balance |

The guarantee in one line: **during a private transfer, an outside observer cannot tell how much moved or who received it.** The 40/60 split and the Alice→Bob relationship are invisible.

### Honest limits (this is v0.1, `Zeto_AnonEnc`)

Privacy is real but not absolute, and it's worth being precise:

- **The public boundaries leak at the edges.** Deposits and withdrawals show real amounts and real accounts. If Alice deposits 100 and shortly after an unrelated-looking account withdraws 40, amount/timing correlation can suggest a link. Privacy is strongest when many users transact and amounts/timing vary — i.e. it depends on the size of the **anonymity set**.
- **This variant reveals which note was spent.** `Zeto_AnonEnc` marks the *input commitment* as spent, so the graph of "this note was spent to create those notes" is visible (as a web of anonymous, valueless fingerprints). It hides amounts, owners, and the sender→recipient identity link — but not the existence of the spend itself. Roadmap variants add **nullifiers**, which hide even *which* note was spent, breaking that last link.
- **No compliance layer yet.** v0.1 deliberately omits KYC, sanctions screening, and auditor viewing keys. Those are later versions (see [`../MVP-Zeto-Hiero.md`](../MVP-Zeto-Hiero.md) roadmap) and change the privacy/oversight balance on purpose.

---

## Why each ingredient matters (quick reference)

| Ingredient | Job |
|---|---|
| **Commitment** = `Poseidon(value, salt, ownerPub)` | Stores a note on-chain as an unrevealing fingerprint |
| **Salt** | Makes commitments unguessable; hides that two notes share a value |
| **Owner (BabyJubJub) key** | Defines who owns a note, without ever appearing on-chain |
| **Zero-knowledge proof** | Enforces value conservation + ownership *without revealing amounts* |
| **ECDH + ephemeral key** | Lets the recipient (and only the recipient) discover their note from the chain |
| **Poseidon cipher** | ZK-friendly encryption, cheap to prove correct inside the circuit |

---

## Mapping back to the tutorial

| Tutorial step | In Zeto terms |
|---|---|
| §6 Deposit | Alice mints a 100-note she owns (public on-ramp) |
| §7 Transfer | Alice spends her note → Bob's 40-note + her 60 change; proof hides the amounts; Bob decrypts his note via ECDH |
| §8 Withdraw | Bob spends his 40-note; pool releases 40 real tokens (public off-ramp) |
| §9 Reconcile | Public balances confirm value was conserved (900 + 40 + 60 = 1000) without ever exposing the private split |

For the runnable walkthrough, see [`TUTORIAL-Zeto-Hiero-Shielded-Pool.md`](TUTORIAL-Zeto-Hiero-Shielded-Pool.md). For the architecture, performance, and roadmap, see [`../MVP-Zeto-Hiero.md`](../MVP-Zeto-Hiero.md).
