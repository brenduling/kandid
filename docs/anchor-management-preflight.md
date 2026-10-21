# Anchoring secret configuration: read-only permission preflight

Local preparation only. This does not approve another production configuration run.

## Run the standalone check

In Windows PowerShell 5.1, from `kandid-clean`:

```powershell
& .\scripts\preflight-kandid-anchor-secrets.ps1
```

Enter the Management API token only at the hidden prompt. Do not put it in a command,
environment file, chat, transcript, or log. The script uses only these two GETs:

- `https://api.supabase.com/v1/projects/fszgdxqxonqqcrzsnkca`
- `https://api.supabase.com/v1/projects/fszgdxqxonqqcrzsnkca/secrets`

Both are checked independently. There are no GitHub calls, writes, worker invocations,
or blockchain requests. Redirects are rejected; TLS validation remains enabled.
Responses stay in memory. Only fixed diagnostic fields and the four approved secret
names found in metadata are reported; values and raw HTTP diagnostics are suppressed.

Required scoped-token permissions on the official project:

| Request | Permission |
| --- | --- |
| GET project | Project Settings Read (`project_admin_read`) |
| GET secret metadata | Edge Function Secrets Read (`edge_functions_secrets_read`) |
| Future approved POST secrets | Edge Function Secrets Write (`edge_functions_secrets_write`) |

Sources: [project](https://supabase.com/docs/reference/api/v1-get-project),
[metadata](https://supabase.com/docs/reference/api/v1-list-all-secrets),
[write](https://supabase.com/docs/reference/api/v1-bulk-create-secrets).

`access_granted: false` with 401/403 means that read was rejected. `null` means access
was not established, for example after a network failure. Missing names do not imply
missing read permission. `ok` additionally requires a matching, healthy project and
valid response structure. A successful preflight proves neither write permission nor
the values stored on either platform. It cannot establish why a previous run failed.

## Configuration diagnostics and recovery

The configuration script now runs both read checks before its first write. Its original
official-project, repository/account, exact confirmation phrase, repeated scheduler
`false`, credential verification, and six-secret scope safeguards remain in place.

Failures report an allowlisted `stage`, `reason`, and numeric `http_status` when known.
Each platform write reports separate attempted and acknowledged flags. The existing
acknowledgment field names are retained. An attempted but unacknowledged write has an
unknown outcome: do not infer that nothing changed and do not retry automatically.
There are no automatic retries. Supabase acknowledges a successful write on response
headers without requiring its body to be read or parsed. A later GitHub failure retains
the earlier Supabase acknowledgment. GitHub CLI stderr is never forwarded.

Retain the canonical credentials securely. After reviewing the preflight and any
metadata evidence, obtain approval for a controlled reconciliation using those same
credentials. Leave scheduling disabled and do not use a worker invocation as a test.

Validation uses only synthetic inputs, mocked gh/node commands, and an in-memory
HTTP handler with no network fallback:

```powershell
node --test tests/anchorManagementDiagnostics.test.mjs tests/anchorSecureConfigPreparation.test.mjs
```
