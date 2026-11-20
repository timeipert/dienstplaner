# Dienstplaner

A local-only monthly duty planner with free duty times. One person enters wishes ("cannot work"
hours), appointments and rules, and generates a plan that covers the required times, reaches the
contract hours of every person and spreads special days fairly.

- **Who it is for:** a small team (first use: 3 persons in a social-work setting) whose plan is
  made by one person once a month. Personal data must not leave the device.
- **Where it runs:** GitHub Pages (static file, no backend). All data stays in the browser of the
  person who plans. Separate project from the KULT shift planner (`../shift-planner`, Firebase),
  which it was forked from on 2026-11-20 and which stays unchanged.
- **State:** 2026-11-20, version 0.2.0 ("hour model", schema 2). The core, all views and the
  scenario tests are done. The repository has been initialized locally but not yet published.
  The rules of the first team are entered as preset "Nachmittagsdienst, 3 Personen (Beispiel)".
- **Language:** the user interface is German; code, comments and documentation are English.

## Start

```bash
npm test          # scenario tests of the generator
npm run build     # writes dist/dienstplaner.html (one self-contained file)
npm run serve     # optional local preview on http://127.0.0.1:5173
```

No dependencies (Node 22 runs the build script and the tests). `dist/dienstplaner.html` also
works when opened directly from disk.

Deploy: pushing to `main` runs `.github/workflows/pages.yml` (tests, build, publish to Pages).
In the repository settings, Pages → Source must be "GitHub Actions".

## Privacy model

- Data lives only in `localStorage` (key `dienstplaner.v1`) of the browser that is used for planning.
- A Content-Security-Policy in `src/index.html` (`default-src 'none'`, `connect-src 'none'`) makes
  the browser refuse any network request. No analytics, no external fonts or scripts. GitHub
  Pages only serves the program file; it never receives data.
- Data is lost when browser data is cleared or the device changes: tab "Daten" downloads a JSON
  backup (contains real names, keep it safe; `.gitignore` excludes such files).

## Monthly workflow

The plan for month M is due on day `deadlineDay` (default 4) of month M−1. The app opens the
following month by default.

1. **Wünsche:** per person and half hour "cannot work" (hard), "wants to work" (preferred),
   "can (exception)" (overrides the weekly pattern); absences (vacation).
2. **Termine:** one-off appointments of the month (for example a case conference) with participants.
3. **Plan:** "Plan erstellen", then adjust duties by clicking a lane; "Fixieren" keeps a duty.
   Status "Wünsche sammeln → Entwurf → Abgeschlossen".
4. Print (A4 landscape, hours table on page 2), CSV, calendar file (.ics) per person.

## Glossary

| Term | Meaning |
| --- | --- |
| Duty ("Dienst") | One working block of a person on one day, free start and end on a 30-minute grid. |
| Coverage ("Besetzung") | Time window per weekday with a minimum number of persons present, for example Mon–Fri 14:00–20:00, 1 person. |
| Weekly coverage | A window that must be covered on n days per week, day chosen freely (for example once a week until 21:00). |
| Appointment ("Termin") | Weekly (team meeting) or one-off; every participant's duty that day must contain it, as one block. |
| Appointment-only duty | A duty that consists only of the appointment (shorter than the person's minimum length); limited per month. |
| Wish string | 48 characters per day, one per half hour: `.` none, `x` cannot, `+` wants, `o` can (exception). |
| Balance weekdays | Weekdays (default Friday) whose duties are spread evenly across persons, including previous months. |
| Late rule | After a duty ending after 20:30 the next day's duty starts at 13:00 at the earliest (configurable). |

## How the first team's requirements are represented (state 2026-11-20)

| Requirement | Setting |
| --- | --- |
| Mon–Fri 14:00–20:00 someone present | Setup → coverage |
| Once a week someone until 21:00 | Setup → weekly coverage 20:00–21:00, 1 day |
| J1, J2: 15 h/week as 3 × 5 h, ideally Mon/Wed/Fri, not on consecutive days | People: 15 h, length 5–5, preferred days, "avoid consecutive" |
| N: 25 h/week, 6-hour duties preferred | People: 25 h, length 5–6, preferred 6 |
| One person: Wednesday from 16:30, Friday until 18:00 | Wishes → weekly pattern (preset example on J2) |
| No morning duties on Wednesday | Setup → duty times Wednesday from 12:00 |
| Fridays balanced per month and across months | Setup → balance weekdays Friday, 3 months of history |
| Everybody one 3-hour weekend duty per month, preferably ending by 20:00; counts as working time | Setup → weekend |
| At most one weekend per month without any duty | Setup → weekend, "at most 1" |
| Tuesday 14:00–15:30 team meeting, everyone, inside the duty | Termine → weekly appointment |
| Coming in only for the meeting at most once a month | Setup → appointment-only duties ≤ 1 |
| Case conference in the morning, varying persons, one block with the duty | Termine → one-off appointment |
| Shared working time balanced between all persons | Weight "shared time" |
| "Cannot work" wishes are hard (override only after talking to the person: edit by hand) | Wishes → "Kann nicht" |
| After a duty until 21:00 no start before 13:00 next day | Setup → late rule |

## Code map

| File | Purpose |
| --- | --- |
| `src/js/model.js` | State shape (schema 2), defaults, presets. |
| `src/js/scheduler.js` | Candidate duties, cost function, optimizer, analysis. Authoritative for rule semantics. |
| `src/js/exporters.js` | CSV and iCalendar text. |
| `src/js/store.js` | localStorage persistence. |
| `src/js/view-*.js`, `app.js`, `ui-core.js` | UI (plan timeline, wishes grid, appointments, people, setup, data). |
| `build.mjs` | Concatenates the modules into `dist/dienstplaner.html`; fails on duplicate top-level names. |
| `tests/scheduler.test.mjs` | Scenario tests (the first team's rules). |
| `docs/generator.md` | How the generator works. |

## Open questions (state 2026-11-20)

| No. | Question | Options | Decided by |
| --- | --- | --- | --- |
| 1 | Do the weekly hours count per calendar week exactly, or may they even out within the month? | Currently: soft target per week, prorated for partial weeks at the month border. | The planner |
| 2 | Do public holidays reduce the target hours? | Currently: closed days reduce the target. | The planner / employer |
| 3 | Is browser storage plus manual backup enough? | Alternative: open/save a local file (File System Access API, Chromium only). | The planner |
| 4 | Breaks: are 6-hour duties allowed without a break, are longer duties (appointment days) given a break? | Not modelled; duties up to `maxDayHours`. | The planner / employer |
