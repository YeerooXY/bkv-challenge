# FamilyHub BKV backend review and install

2026-11-11. The owner explicitly replaced the exhausted Opus review route with direct work by the lead. No worker calls were made in this turn. The earlier Sonnet 5.5 medium draft is reused; the earlier failed Opus attempt produced no findings.

## Review and corrections

The deployment reuses backend/server.py and futar.py without changing their API, caching, validation or redaction. A dedicated nologin user runs the API on VM loopback port 8001. Existing FamilyHub media paths, containers and music services remain unchanged.

The draft handoff instructions could print a decrypted key. Replaced that step with install-key.py: ciphertext is decrypted into process memory, validated, quoted for systemd and atomically written as a root-only environment file. Decryption failure preserves the previous file. Added key-format tests. Added bytecode suppression, unbuffered service output, a 256 MiB cap and a task limit to the unit. No new runtime dependencies.

The manual-only GitHub workflow passes public PEM and the existing BKK secret through environment variables, validates RSA size and OAEP capacity, and uploads only ciphertext with one-day retention. Explicit OAEP and MGF1 SHA-256 parameters match the VM helper. No PR/push trigger, private key export, plaintext artifact or client key was introduced.

## Executed verification

- Actual workflow shell body passed a dummy-key encrypt/decrypt round trip on Debian with RSA 3072 and OAEP/MGF1 SHA-256.
- systemd-analyze verify passed for the installed unit.
- 33 Python tests and 14 JavaScript tests passed, including two new key-format tests.
- Provision BKK key run 43080229676 succeeded. Its encrypted artifact was transferred to the VM and installed without printing plaintext. The private provisioning key and ciphertext are temporary; the normal service secret is /etc/bkv-challenge/api.env, mode 0600 root:root.
- bkv-api.service is enabled and active as bkv-api, with zero restarts. Initial live-request memory was approximately 19 MiB; this is an observation, not a load test.
- Real arrivals for six central Deak stops returned state ok: 25 arrivals, 17 registration plates, 20 live predictions.
- Existing five Docker containers retained their original uptime; Jellyfin remained healthy. The music service was not restarted.
- Pages-origin CORS headers passed. The service user cannot read the root-only environment file. After live verification the VM provisioning private key, both transferred ciphertext copies and the GitHub artifact were deleted. The normal service key remains installed.

## Connection blocker

Automatic approval review rejected the command that would start a hidden SSH forward and add Tailscale Serve port 8445. The only stated reason was "blocked by policy". The rejected tool call did not execute. No alternate tool or route was used to bypass it.

The API is installed and works inside the VM. The phone-facing HTTPS route and app apiBase remain unconfigured. connect-windows.ps1 is prepared for review and was syntax-checked only; it has not been executed. The existing 8443/8444 routes remain unchanged. Once the connection is allowed and verified, publish the private apiBase, refresh the service-worker cache and build an updated APK. Phone access will require Tailscale and a running Windows host, VM and tunnel.
