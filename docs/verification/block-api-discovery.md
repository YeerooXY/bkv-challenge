# Documented BKK duty association

Lead discovery during Astra review, 2026-11-16 ~14:23 UTC. The official https://opendata.bkk.hu/docs/futar-openapi.yaml documents includeVehicleFromVehicleBlock on arrival endpoints: expand a stop departure with the vehicle on its vehicle duty. It also documents nextBlockTripId on trip details.

Live paired requests for line 225, same stop and flags except includeVehicleFromVehicleBlock false/true:

- F02886 D18484481: no vehicle -> SKR806, vehicle.tripId D18484476.
- F03175 D18484478: no vehicle -> MFW522, vehicle.tripId D18484477.
- F03175 D18484480: no vehicle -> AAHY805, vehicle.tripId D18484479.

All vehicle and row serviceDate values were 20261116; positions were fresh. This exactly recovers the earlier inferred candidates without local prefix interpretation, full-feed downloads, new dependencies or extra requests. Recommended narrower implementation: enable this parameter in the existing stop request, retain source trip/date in parsed vehicle, and distinguish direct same-trip identity from a provider block-associated candidate. Other-trip candidates need explicit Likely wording, no New/Completed badge derived from inferred identity, and explicit plate confirmation or manual entry at Board. Reject stale, conflicting-date or untraceable block identities. Do not change historical matching queries to treat a duty candidate as observed occupancy of a future trip.
