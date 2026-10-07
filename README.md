# PepLogs

Static injection journal, served by GitHub Pages, with a Google Apps Script web app as its API. Each browser connects to the deployment URL supplied in the setup screen.

## Local checks

Node.js 18 or newer; no npm dependencies are required for the regression tests:

```sh
TZ=Europe/Ljubljana node --test tests/*.test.cjs
python3 -m http.server 8000
```

Use a test Apps Script deployment and a disposable Sheet for browser write tests.

## Scheduling rules

`planning.js` owns the calendar-day calculations used by the dashboard, cycle badges, calendar and reminders.

- A valid `active/rest` cycle takes precedence over frequency. `5/2` means five active calendar days followed by two rest days, repeated continuously. `5/0` has no rest days.
- The earliest valid recorded injection of the peptide is day one. Later injections and missed days do not move the cycle. Adding or removing the earliest record can change this inferred start.
- An injection logged on the current local day marks that day complete. On rest days the app does not suggest catching up missed injections.
- Frequency uses a positive whole number of calendar days after the latest recorded injection. Zero means no frequency schedule. Invalid cycles do not silently fall back to frequency.
- Without a recorded injection there is no inferred start or predicted date. The cycle badge still indicates an active cycle.
- Matching is currently by peptide, not by preset. Multiple daily doses and independently anchored presets for the same peptide need an explicit data-model extension.
- Predictions are calendar-day estimates. Local date arithmetic avoids UTC date shifts and daylight-saving errors.

## Offline behavior

The queue preserves operation order and removes each entry only after a successful server response. A failure retains the failed entry and every unattempted entry. Concurrent refreshes/drains within one tab share their in-flight operation; new queued writes survive an ongoing drain.

All current write actions, including creating and closing reconstitutions, can be queued. Pending changes are projected over server reads so a refresh does not hide them. Local storage failure is reported as failure, not success. Newly created local rows cannot be edited or removed until synchronized, because the current server API requires a real Sheet row number.

Caches and queues are scoped to the configured deployment URL. Legacy unscoped data is adopted by the URL connected on the first upgraded launch. The old format does not contain an original database identifier; verify that the expected database is connected before upgrading a browser with legacy pending writes.

## Remaining backend work / review gates

This first patch does not change or deploy Apps Script, migrate Sheets, or alter the live site's main branch.

- The existing backend is **not idempotent**. If a write succeeds but its response is lost, retrying can still duplicate it on the server. Durable operation IDs and server-side deduplication are required; the local Quick Log double insertion fixed here is a separate bug.
- Mutations still address Sheet row numbers. A preceding deletion or an edit from another device can cause a queued operation to become stale. The server's existing verification remains in place. A rejected operation blocks the ordered queue and is kept for recovery; automatic conflict resolution is not implemented.
- Queue coordination is within one browser tab, not a transaction across tabs/devices. Avoid simultaneous offline editing in multiple tabs until cross-tab coordination and server idempotency are implemented.
- Confirm whether each Sheet has its own bound script deployment or one deployment is expected to route between Sheets before changing backend routing/locking. `getActiveSpreadsheet()` alone is not a multi-Sheet router.
- Before release, decide whether the inferred cycle start is sufficient or add a persistent, editable start date per preset.

## Validation of this patch

23 automated regressions cover scheduling, missing/invalid/future history, full-month predictions, DST dates, offline Quick Log, rejected writes, partial queue failures, concurrent drains, newly appended writes, legacy migration, database separation, reconstitutions, pending-row guards, storage quota failure, reload recovery, and stale GET responses.

Browser/PWA verification remains required before merging: the available environment could not install Chromium (the download returned an invalid archive). No live Google Sheet writes or real notification delivery were tested.
