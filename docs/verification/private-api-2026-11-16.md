# Private API connection

2026-11-16: Executed the existing connect-windows.ps1 script following the owner's request to connect the app. SSH tunnel PID 12968 forwards Windows loopback 18766 to VM loopback 8001. Tailscale Serve port 8445 proxies that tunnel; existing 8443 and 8444 routes were preserved.

HTTPS health returned schemaVersion 1 and live true. Arrivals for F00954 returned state ok and M3 arrivals. The Pages origin received the expected Access-Control-Allow-Origin header. No keys were printed or changed.

Published apiBase and service-worker cache v21 in fad8c5b. Pages deployment 43848833990 succeeded; the published configuration returned the private endpoint. Android release build: 43848834265.

Physical phone access remains untested. The phone needs Tailscale on the same tailnet. Windows, VM and SSH tunnel must remain running; the tunnel has no automatic restart after reboot. No visual interface changes were made.
