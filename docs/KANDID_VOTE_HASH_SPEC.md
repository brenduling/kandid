# KANDID Vote Hash Specification

## 1. Purpose

`KANDID_VOTE_V2` defines the future privacy-safe vote commitment format for KANDID blockchain anchoring. The blockchain stores only the resulting SHA-256 digest. Supabase remains the operational source of truth for vote records, eligibility, election phase validation, and ballot submission.

This specification does not modify existing production vote hashes.

## 2. Version Identifier

Version identifier:

```text
KANDID_VOTE_V2
```

Legacy hashes generated before this specification are `legacy_v1` hashes. They are existing JSON-based SHA-256 hashes and must remain unchanged.

## 3. Fields

The V2 canonical payload contains exactly these material fields:

| Field | Meaning |
| --- | --- |
| `version` | Fixed literal `KANDID_VOTE_V2`. |
| `vote_id` | The persisted database vote row identifier. |
| `election_id` | The persisted election identifier. |
| `position_id` | The persisted position identifier. |
| `candidate_id` | The persisted candidate identifier, or null for abstain. |
| `is_abstain` | Whether the row is an abstain vote. |
| `submitted_at_utc` | The canonical server-created submission timestamp. |
| `nonce` | A server-generated 256-bit random nonce. |

Current KANDID stores one vote row per persisted position/candidate or abstain choice. V2 Phase A anchors each persisted vote row independently.

## 4. Excluded Information

The canonical payload must not include:

- `student_id`
- `student_number`
- student name
- email
- password
- organization membership
- raw ballot payload

Voter eligibility and duplicate-vote enforcement remain backend responsibilities. The blockchain commitment is not a voter identity record.

## 5. Canonical Serialization

The canonical string format is:

```text
KANDID_VOTE_V2|vote_id:<integer>|election_id:<integer>|position_id:<integer>|candidate_id:<integer-or-null>|abstain:<0-or-1>|submitted_at:<ISO-UTC-ms>|nonce:<hex>
```

Rules:

- Field order is fixed exactly as shown.
- The field separator is the ASCII pipe character: `|`.
- Labels are lowercase except the version literal.
- Each label is followed by one ASCII colon: `:`.
- Integer values are base-10 ASCII digits with no leading zeros.
- `candidate_id` is either a base-10 integer or the literal `null`.
- `abstain` is `1` for true and `0` for false.
- `submitted_at` is UTC ISO-8601 with exactly three milliseconds digits and a trailing `Z`.
- `nonce` is exactly 64 lowercase hexadecimal characters and has no `0x` prefix inside the payload.
- No spaces are inserted around separators or labels.

## 6. Nonce Specification

The nonce is generated server-side with a cryptographically secure random byte generator.

Required properties:

- 32 random bytes.
- Encoded as exactly 64 lowercase hexadecimal characters.
- Stored server-side with the vote row.
- Never stored on chain.
- Never derived from voter identity, vote contents, timestamp, or database IDs.

The nonce prevents practical candidate enumeration from a public blockchain hash. Without the nonce, an observer who knows the election, position, candidate list, and approximate time could brute-force likely vote payloads. A uniformly random 256-bit nonce makes that search computationally infeasible.

## 7. Timestamp Specification

`submitted_at_utc` must be created by the secure backend submission path, not by the browser.

The future implementation should persist the exact canonical timestamp value used in the hash. The safest database representation is a dedicated text column such as `submitted_at_utc` containing the exact ISO-8601 value with milliseconds and trailing `Z`, for example:

```text
2026-09-12T04:15:30.123Z
```

Do not depend on reconstructing the canonical timestamp from the existing `timestamp without time zone` `votes.vote_timestamp` column. Reconstructing can be ambiguous if session time zone, precision, or formatting behavior differs.

## 8. SHA-256 Specification

Hash input:

- The exact canonical string.
- Encoded as UTF-8 bytes.

Digest:

- SHA-256.
- 32 bytes.

Output representation:

- Lowercase hexadecimal.
- Prefixed with `0x`.
- Exactly 66 characters total: `0x` plus 64 hex characters.

## 9. Output Format

Example output shape:

```text
0xf07be55a11d50083efbd098ecdc297034455c303aa3f4d4063fa9f69bc26b42a
```

The raw digest is 32 bytes. The `0x` prefix is only a textual representation and is not part of the digest bytes.

## 10. Candidate Vote Example

Input fields:

```json
{
  "vote_id": 1001,
  "election_id": 21,
  "position_id": 7,
  "candidate_id": 301,
  "is_abstain": false,
  "submitted_at_utc": "2026-09-12T04:15:30.123Z",
  "nonce": "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
}
```

Canonical string:

```text
KANDID_VOTE_V2|vote_id:1001|election_id:21|position_id:7|candidate_id:301|abstain:0|submitted_at:2026-09-12T04:15:30.123Z|nonce:000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
```

UTF-8 interpretation: the canonical string contains only ASCII characters, so the UTF-8 byte sequence is the byte value of each displayed character.

Expected SHA-256 digest:

```text
0xf07be55a11d50083efbd098ecdc297034455c303aa3f4d4063fa9f69bc26b42a
```

## 11. Abstain Example

Input fields:

```json
{
  "vote_id": 1002,
  "election_id": 21,
  "position_id": 8,
  "candidate_id": null,
  "is_abstain": true,
  "submitted_at_utc": "2026-09-12T04:16:05.987Z",
  "nonce": "1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100"
}
```

Canonical string:

```text
KANDID_VOTE_V2|vote_id:1002|election_id:21|position_id:8|candidate_id:null|abstain:1|submitted_at:2026-09-12T04:16:05.987Z|nonce:1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100
```

UTF-8 interpretation: the canonical string contains only ASCII characters, so the UTF-8 byte sequence is the byte value of each displayed character.

Expected SHA-256 digest:

```text
0xd02cb863c0c45b26225281d6dd3a42ca5137eca3b579ec879c3eff33c0d77a9a
```

## 12. Test Vectors

All vectors are deterministic test-only examples and do not use real students or production votes.

### Vector 1: Normal Candidate Vote

Canonical string:

```text
KANDID_VOTE_V2|vote_id:1001|election_id:21|position_id:7|candidate_id:301|abstain:0|submitted_at:2026-09-12T04:15:30.123Z|nonce:000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
```

Expected digest:

```text
0xf07be55a11d50083efbd098ecdc297034455c303aa3f4d4063fa9f69bc26b42a
```

### Vector 2: Abstain Vote

Canonical string:

```text
KANDID_VOTE_V2|vote_id:1002|election_id:21|position_id:8|candidate_id:null|abstain:1|submitted_at:2026-09-12T04:16:05.987Z|nonce:1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100
```

Expected digest:

```text
0xd02cb863c0c45b26225281d6dd3a42ca5137eca3b579ec879c3eff33c0d77a9a
```

### Vector 3: Different Candidate, Otherwise Same As Vector 1

Canonical string:

```text
KANDID_VOTE_V2|vote_id:1001|election_id:21|position_id:7|candidate_id:302|abstain:0|submitted_at:2026-09-12T04:15:30.123Z|nonce:000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
```

Expected digest:

```text
0xb5b3ad16ab9a71778f2ae4d3a6079ddba65e3bab217e14f124e7361dd7457489
```

### Vector 4: Same Vote Data As Vector 1, Different Nonce

Canonical string:

```text
KANDID_VOTE_V2|vote_id:1001|election_id:21|position_id:7|candidate_id:301|abstain:0|submitted_at:2026-09-12T04:15:30.123Z|nonce:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
```

Expected digest:

```text
0x6353ec4738259fb6818795cb536ada6ee5f660179079f3e640e638c4f4b44c3a
```

## 13. Verification Algorithm

To verify a V2 hash:

1. Load the persisted vote row and its V2 metadata from Supabase.
2. Confirm the row is marked as `KANDID_VOTE_V2`.
3. Build the canonical string using the exact serialization rules in this document.
4. UTF-8 encode the canonical string.
5. Compute SHA-256.
6. Convert the digest to lowercase `0x`-prefixed hex.
7. Compare the computed digest to `votes.vote_hash`.
8. If blockchain anchoring is enabled, pass the 32-byte digest to `KandidVoteRegistry.isVoteHashRecorded(bytes32)`.

The caller-provided data is never authoritative for recomputation. Supabase row data is authoritative.

## 14. Legacy V1 Handling

`legacy_v1` is the existing current JSON-based SHA-256 hash behavior used by current production vote rows. Current V1 includes `studentId` in the JSON payload and stores the digest in `votes.vote_hash`.

Existing V1 hashes must remain untouched. The currently existing 63 vote hashes are not converted to V2.

Future verification must branch by hash version:

- `legacy_v1`: verify using the legacy JSON method only where needed for old rows.
- `KANDID_VOTE_V2`: verify using this canonical string specification.

## 15. Privacy Properties

`KANDID_VOTE_V2` removes direct voter identity from the canonical payload. It does not include student ID, student number, name, email, password, or organization membership.

The digest commits to the persisted vote row and vote content, but the random 256-bit nonce prevents practical public enumeration of candidate selections. Even if an observer knows the election, position, candidate set, and timestamp range, they cannot feasibly search the nonce space.

Supabase remains responsible for access control. A public blockchain hash alone must not reveal who voted.

## 16. Blockchain bytes32 Compatibility

SHA-256 outputs exactly 32 bytes. The existing Solidity contract accepts:

```solidity
function recordVoteHash(bytes32 voteHash)
```

The V2 digest is directly compatible with this function after converting the `0x`-prefixed 64-hex-character representation to a `bytes32` value. No contract change is required for the hash format.

## Implementation Decision: vote_id vs Pre-Generated Identifier

The current V2 format freezes `vote_id` as the row-binding identifier.

Reasoning:

- `vote_id` binds the digest to the persisted Supabase vote row.
- `vote_id` avoids introducing a second public identifier that must be kept unique and immutable.
- Current KANDID already treats each persisted vote row as the unit represented by `votes.id`.

This creates an ordering requirement because `vote_id` exists only after insertion. The future implementation must therefore generate the nonce and canonical timestamp server-side, insert the vote row to obtain `votes.id`, compute the V2 hash using that returned ID, and persist the hash before the row is treated as anchor-ready.

The safest future implementation is a controlled server-side submission path that prevents any successfully accepted vote from being left permanently without its V2 hash. If a later implementation cannot make insert-and-hash persistence sufficiently atomic, then Phase B should revisit a pre-generated immutable vote UUID. Phase A3 does not add that UUID.

## Determinism Test Result

PASS. Hashing the exact same canonical string repeatedly produced the exact same digest:

```text
0xf07be55a11d50083efbd098ecdc297034455c303aa3f4d4063fa9f69bc26b42a
```

## Field Sensitivity Test Result

PASS. Changing each important field changed the digest.

| Changed field | Result |
| --- | --- |
| `vote_id` | PASS |
| `election_id` | PASS |
| `position_id` | PASS |
| `candidate_id` | PASS |
| `is_abstain` | PASS |
| `submitted_at_utc` | PASS |
| `nonce` | PASS |

## Multi-Candidate Position Note

Current voting code appears to create one persisted vote row per selected candidate or abstain choice, while the live database has a uniqueness constraint equivalent to one vote per `student_id` and `position_id`. That may conflict with positions where `max_votes > 1`.

This is not fixed in Phase A3. For V2 Phase A, anchoring is defined per persisted vote row. Full-ballot or Merkle-style anchoring remains future architecture work.

## Remaining Blockers Before Database Migration

- Add V2 metadata columns only in a later approved migration.
- Decide the exact future column name for the canonical timestamp text value.
- Decide how the secure backend vote submission path will guarantee insert, hash calculation, and hash persistence before anchor eligibility.
- Add a `hash_version` discriminator so legacy V1 and V2 rows can coexist.
- Add nonce storage for V2 rows.
- Keep existing V1 vote rows unchanged.
- Address or explicitly defer the `max_votes > 1` persistence issue separately from blockchain anchoring.
