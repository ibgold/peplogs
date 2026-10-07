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

All current write actions, including creating and closing reconstitutions, can be queued. Pending changes are projected over server reads so a refresh does not hide them. Local storage failure is reported as failure, not success. Newly created local rows cannot be edited or removed until synchronized, to preserve compatibility with the legacy row-based API during rollout.

Caches and queues are scoped to the configured deployment URL. Legacy unscoped data is adopted by the URL connected on the first upgraded launch. The old format does not contain an original database identifier; verify that the expected database is connected before upgrading a browser with legacy pending writes.

## Apps Script v2

[apps-script/Code.gs](apps-script/Code.gs) is the complete replacement API for each independently copied bound script. Follow the [French installation and test guide](apps-script/DEPLOYMENT.md). Run `setupPepLogs` in each Sheet's editor to pin that project's database and add stable metadata without rearranging the business columns.

Reads no longer acquire the write lock. Writes flush before releasing it. Creation request IDs are retained in the same row as the data, so a lost acknowledgement can be retried without another append. Version checks reject outdated edits; supplied stable IDs locate moved rows without falling back to an unrelated row. Deletions retain tombstones that prevent delayed create retries from restoring deleted entries. The original formula-injection and legacy row-verification protections remain.

The frontend supplies a request ID before each first attempt and preserves it in the offline queue. It passes stable IDs and expected versions when supplied by the server, keeps the original edit-modal target across refreshes, and avoids displaying pending creations twice when the server already contains them.

## Remaining review gates

This branch prepares code only. No live Apps Script deployment, Sheet migration, or main-branch release has been performed.

- Server deduplication needs both the new frontend and v2 backend. It cannot retroactively deduplicate legacy requests sent without a request ID.
- A stale operation still blocks the ordered queue and is kept for recovery. A conflict-resolution interface is not implemented.
- Browser queue coordination remains within a tab, not a cross-tab transaction. Server request IDs prevent replaying the same identified creation, but cannot prevent two independent user submissions with different IDs.
- Version checks cover API edits; manual Sheet content edits do not automatically increment the version.
- Before release, validate the inferred cycle start or add a persistent, editable start date per preset.
- The v2 deletion marker requires care on rollback: an old backend does not filter it. See the installation guide.

## Validation of this patch

46 automated regressions pass with `TZ=Europe/Ljubljana node --test tests/*.test.cjs`. They exercise scheduling, DST, offline recovery, migration, lock behavior, idempotent writes, moved rows, version conflicts, formula preservation, and frontend/backend integration with lost responses. Tests use synthetic Sheets and a local simulator of the Apps Script services.

Browser/PWA and real Apps Script verification remain required before merging: the available environment could not install Chromium (the download returned an invalid archive). No live Google Sheet writes or real notification delivery were tested.
