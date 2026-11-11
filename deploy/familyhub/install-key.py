"""Install the encrypted GitHub BKK key without sending plaintext to stdout."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

CONFIG = Path("/etc/bkv-challenge")
ORIGINS = "https://yeerooxy.github.io,https://localhost,http://localhost"


def env_value(key):
    if not key or len(key) > 318 or any(ord(c) < 33 or ord(c) > 126 for c in key):
        raise ValueError("Invalid BKK key format")
    return '"' + key.replace("\\", "\\\\").replace('"', '\\"') + '"'


def main():
    if os.geteuid() != 0 or len(sys.argv) != 2:
        sys.exit("Run as root: install-key.py path/to/bkk-key.enc")
    result = subprocess.run([
        "openssl", "pkeyutl", "-decrypt", "-inkey", str(CONFIG / "provision-private.pem"),
        "-in", sys.argv[1], "-pkeyopt", "rsa_padding_mode:oaep",
        "-pkeyopt", "rsa_oaep_md:sha256", "-pkeyopt", "rsa_mgf1_md:sha256",
    ], capture_output=True)
    if result.returncode:
        sys.exit("BKK key decryption failed")
    try:
        value = env_value(result.stdout.decode("ascii"))
    except (UnicodeDecodeError, ValueError):
        sys.exit("Invalid BKK key format")
    fd, name = tempfile.mkstemp(prefix=".api.env-", dir=CONFIG)
    try:
        with os.fdopen(fd, "w", encoding="ascii") as stream:
            stream.write(f"BKK_API_KEY={value}\nALLOWED_ORIGINS={ORIGINS}\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, CONFIG / "api.env")
    finally:
        Path(name).unlink(missing_ok=True)
    print("BKK service environment installed (root-only)")


if __name__ == "__main__":
    main()
