# BKV API on the FamilyHub VM

The existing Python API runs as a separate systemd service alongside FamilyHub. It uses the standard library and the existing `futar.py` adapter. It listens only on VM loopback `127.0.0.1:8001`.

## Install

Copy `backend/server.py`, `backend/futar.py`, `bkv-api.service` and `install-key.py` to a temporary staging directory on the Debian VM. As root:

```sh
id bkv-api >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin bkv-api
install -d -m 0755 /srv/familyhub/services/bkv-challenge/backend
install -m 0644 server.py futar.py /srv/familyhub/services/bkv-challenge/backend/
install -d -m 0700 /etc/bkv-challenge
install -m 0700 install-key.py /etc/bkv-challenge/install-key.py
install -m 0644 bkv-api.service /etc/systemd/system/bkv-api.service
systemd-analyze verify /etc/systemd/system/bkv-api.service
```

Provision the key below before starting the service. Then:

```sh
systemctl daemon-reload
systemctl enable --now bkv-api
curl --fail http://127.0.0.1:8001/v1/health
```

The service restarts on failure and at boot. Its user cannot modify the application or FamilyHub media. Memory is capped at 256 MiB. The service environment stays `0600 root:root`; systemd reads it before switching user. CORS permits the Pages origin and Android Capacitor localhost origins.

## Key handoff

`BKK_API_KEY` already exists as a GitHub Actions secret. The manual `Provision BKK key` workflow encrypts it to an ephemeral VM-only RSA public key. Only encrypted bytes leave GitHub; the private key remains on the VM. No key is included in source or client assets.

1. As root on the VM, generate the recipient key with a restrictive umask:

   ```sh
   umask 077
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out /etc/bkv-challenge/provision-private.pem
   openssl pkey -in /etc/bkv-challenge/provision-private.pem -pubout
   ```

2. Dispatch the workflow with that public PEM as `recipient_public_key`. Download artifact `bkk-key`, then transfer `bkk-key.enc` to the VM.
3. Install without printing plaintext:

   ```sh
   python3 /etc/bkv-challenge/install-key.py /path/to/bkk-key.enc
   ```

   The helper validates the decrypted value, quotes it for systemd, and atomically writes the root-only environment file. It preserves an existing configuration if decryption or validation fails.
4. After a successful live API check, delete the encrypted artifact from GitHub and remove the transferred ciphertext and `/etc/bkv-challenge/provision-private.pem`. The normal service key remains only in `/etc/bkv-challenge/api.env` on the VM and the existing GitHub secret.

## Private HTTPS access

The Windows Tailscale node provides a separate Serve port 8445, proxying `127.0.0.1:18766`. A separate SSH tunnel forwards that port to VM `127.0.0.1:8001`, using the existing saved key and strict host-key verification. Existing music routes 8443/8444 are preserved. Never enable Funnel for this service.

The app's `data/api.json` points to the private HTTPS API. A phone needs Tailscale connected to the same tailnet. Windows, the VM and the tunnel must be running. The eventual dedicated Linux server should host its own Tailscale endpoint directly.

Current installation: the VM service and key are installed and live arrivals pass inside Debian. Automatic approval review blocked the Windows connection command. `connect-windows.ps1` prepares that connection using the existing VM keys; it has been syntax-checked, not executed. The app's API address is still unchanged pending a successful HTTPS check. The SSH process started by this script does not automatically restart after Windows reboots; persistent tunnel management remains a follow-up after the connection is allowed and verified.

## Rollback

Disable only the BKV Serve port with `tailscale serve --https=8445 off`, stop its dedicated Windows tunnel, and run `systemctl disable --now bkv-api` in the VM. Remove `/etc/systemd/system/bkv-api.service`, reload systemd, then remove the dedicated `/etc/bkv-challenge` and `/srv/familyhub/services/bkv-challenge` directories and the `bkv-api` account. Preserve every other FamilyHub service, route and data directory. Restore the previous app `apiBase` and refresh its service-worker cache when publishing rollback.
