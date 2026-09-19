# Delivery reliability changes

Scheduled and manual delivery now distinguish a normal schedule skip from a failed attempt. Invalid configuration,
an unreadable site manifest, or unreadable delivery state fails the gate job. A manual test with no published edition
also fails. These cases no longer look like a successful test mail in the application.

The mail CLI writes `sent=true` to its GitHub step output only after the provider accepts every intended recipient and
delivery state is saved. `mail.yml` then runs the fixed **Mail delivery confirmed** step. The browser checks that step's
result through the workflow jobs API, rather than treating a green workflow as proof of delivery. Update both the app
and `mail.yml` together. Provider acceptance does not guarantee inbox placement or prevent later bounces.

## Partial SMTP delivery

Nodemailer can resolve successfully when only some recipients were accepted. The sender now inspects the per-recipient
result. Within a run, only temporary rejections are retried. Accepted recipients are recorded before another attempt.
The next scheduled run skips those accepted addresses and tries only recipients that remain outstanding.

`state/mail.json` keeps optional `pending[slot]` records with `delivered` and `failed` arrays. These contain SHA-256
fingerprints of the edition/week id plus the normalized address; no address or credential is written to state or
the public API. Errors are scrubbed. `last.status` may be `sent`, `partial`, or `failed`, with optional delivered/failed
counts. A slot enters `sent` only after all recipients have been accepted; completing it removes its pending record.
Older state files without these optional fields remain readable. A deliberate `--force` starts a new delivery record.

SMTP and the GitHub state store cannot participate in one atomic transaction. If the provider accepts mail but the
process dies or the very first acknowledgement write fails, that acceptance cannot be reconstructed reliably. The
application reports the failure and does not immediately resend the accepted transaction. Persistent progress prevents
duplicates for acknowledged recipients; it is not a claim of exactly-once delivery under every transport failure.

## Schedule preview and defaults

New configurations default weekly delivery to Tuesday at 08:30 in the reader's timezone. Existing repository variables
and saved drafts are respected. This avoids the old Monday-morning Asian default selecting the week before last while
the US-Pacific Sunday edition is still open.

Delivery settings show the next planned send time and the exact edition dates it covers. A warning appears when the
selected weekly time will send an older week. The preview describes the editable draft; save it to apply it. GitHub's
schedule can be delayed, and the normal grace-window behavior still applies.

The pure browser-safe function `previewSchedule(mail, edition, now)` is exported from `@resonance/channels/schedule`.
It returns `kind`, `at` (UTC ISO instant), `slot`, `from`, `to`, and `staleWeek`. If the caller knows and supplies
`edition.settleHours`, the result also includes `settledAt`; the manifest currently does not expose this setting.

Custom SMTP passwords now preserve all characters, including whitespace. Whitespace normalization is limited to the
known QQ, 163, and Gmail app-password presets. A malformed local-server request URL receives HTTP 400 instead of
terminating the local website and relay process.

Regression coverage uses in-memory providers and GitHub mocks plus a loopback HTTP server. No real emails or remote
configuration changes are needed for these checks.
