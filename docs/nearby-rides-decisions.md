# Ride completion clarification

User clarification, 11 November 2026. This supersedes conflicting proposed GPS qualification rules in `nearby-rides-astra-plan.md` and the coordinator assessment in `nearby-rides-plan-review.md`. It records requirements and research only; no app implementation is included.

- The duration requirement for a plate is at least 600 seconds on the session timer between boarding and getting off. GPS coverage and live API availability do not gate completion. Existing photo saving requirements remain separate.
- Manual vehicle selection also starts a timed ride with GPS recording. Manual selection does not require a separate evidence qualification policy.
- Persist boarding/end timestamps and available GPS observations locally. An internet outage does not pause the timer. Keep phone suspension, unavailable GPS and network outages distinct; never fabricate missing GPS samples.
- Approximate missing ride details using available evidence and label estimates. Preserve user corrections. A predicted departure, scheduled departure or inferred stop passage must retain its provenance.
- After reconnection, attempt to reconcile the saved trip/vehicle/plate, service date, stops and ride-time window against matching API observations. API confirmation remains separate from duration completion. Missing or conflicting data does not undo a completed timer.
- If the API cannot return the relevant past observations, retain an approximate/unconfirmed record. A server-side observation cache is a possible addition if historical reconciliation is needed; it can retain only observations actually captured and cannot recreate an upstream outage.

## Arrival time display

User selection, 11 November 2026: when a live prediction changes the displayed scheduled time, show the original time crossed out in red, immediately followed by the predicted time in red. Example: scheduled 14:00, predicted 14:07. Keep both times visible in the same arrival row. Provide an accessible description such as "Scheduled 14:00, predicted 14:07" so meaning does not depend on color or strikethrough alone. When only a scheduled time is available, show it normally and label it Scheduled; do not invent a prediction.

## API findings

The official FUTÁR OpenAPI schema was retrieved without authentication on 11 November 2026. No authenticated response or historical retention behavior was tested.

- Stop arrival/departure queries include a `minutesBefore` parameter around the requested `time`. This defines a query window; it does not establish historical retention.
- `departureTime` is documented as scheduled departure, and `predictedDepartureTime` as estimated departure. Neither field alone establishes an observed departure event.
- Vehicle objects expose `licensePlate`, `location` and `lastUpdateTime`. Actual field population and past vehicle-to-trip assignments still need representative authorized samples.
- GTFS Realtime permits dropping past stop updates. Its current feed alone is not a guaranteed archive for delayed reconciliation.

Sources: [FUTÁR OpenAPI](https://opendata.bkk.hu/docs/futar-openapi.yaml), [BKK data sources](https://opendata.bkk.hu/data-sources), [GTFS Trip Updates](https://gtfs.org/documentation/realtime/feed-entities/trip-updates/).

## Remaining boundary

Offline recording is feasible while the device supplies location updates. Internet reconnection does not reconstruct GPS points missed during screen lock or app suspension. Timer completion remains available despite those gaps; API matching supports the record when the required observations exist.
