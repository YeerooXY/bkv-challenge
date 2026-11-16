# Compact screens and ride flow, 2026-11-16

Implemented the owner's screen-plan and additional motion/focus suggestions. Captures cover four emulated profiles in two themes. See ../ux-coverage.md for the exact checks and limits. Run tests/browser/ride-redesign.cjs with the local server on port 8000 to reproduce.

Validation: 18 Node tests, 42 Python tests; eight profile/theme browser flows; four recovery checks; two reconciliation/service-worker checks. Automated axe scans cover the main screens and ride states. Results are stored in results.json.

Runtime backend updated separately: the vehicle lookup now includes validated tripId/serviceDate, without extra upstream requests. Health returned live=true. Live line 7 returned 16 vehicles with trip metadata; line 225 returned a successful empty result at verification time. This does not establish that 225 was out of service.

The new normal path is Board, End ride, Save ride, plus photo selection/capture. Unknown plates remain visible and cannot start an identified ride. Likely identities require explicit confirmation. New bus completion uses 600 seconds and three rider-confirmed stop-to-stop legs, metro one station leg; legacy entries retain their prior qualification. Completion is not independent GPS proof.

Source-backed wording fixes include obsolete README/manual-logging advice and the Progress heading that called missing reports 'out of service'. The current heading describes last reports.

No physical devices or screen readers were used. Real map tiles were disabled in fixture tests; native camera behavior remains unverified.
