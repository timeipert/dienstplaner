# Dienstplaner

A local-only monthly duty planner with free duty times. One person enters wishes ("cannot work"
hours), appointments and rules, and generates a plan that covers the required times, reaches the
contract hours of every person and spreads special days fairly.

- **Who it is for:** a small team (first use: 3 persons in a social-work setting) whose plan is
  made by one person once a month. Personal data must not leave the device.
- **Where it runs:** GitHub Pages (static file, no backend). All data stays in the browser of the
  person who plans. Separate project from the KULT shift planner (`../shift-planner`, Firebase),
  which it was forked from on 2026-11-20 and which stays unchanged.
- **State:** 2026-11-20, version 0.8.0. Published at https://timeipert.github.io/dienstplaner/
  (repository `timeipert/dienstplaner`). The app ships only neutral defaults ("Grundeinstellungen":
  no persons, no appointments, no named examples). The three-person scenario of the first team is
  kept as test data in `tests/fixture.mjs`.
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

## Colors

The design is black, white and grey. **Red is the only color and appears only for rule
violations** (`--bad` in `src/styles.css`): cells and bars of duties that break a hard rule (for
example an appointment that the duty does not contain, or an appointment inside a time the person
cannot work), uncovered required times (hatched), and violated rules in the evaluation. Soft
issues ("rather not", "maybe") are only dotted-underlined in red. Everything else is never colored.

## Privacy model

- Data lives only in `localStorage` (key `dienstplaner.v1`) of the browser that is used for planning.
- A Content-Security-Policy in `src/index.html` (`default-src 'none'`, `connect-src 'none'`) makes
  the browser refuse any network request. No analytics, no external fonts or scripts. GitHub
  Pages only serves the program file; it never receives data.
- Data is lost when browser data is cleared or the device changes: tab "Einstellungen" → "Daten und Datenschutz" downloads a JSON
  backup (contains real names, keep it safe; `.gitignore` excludes such files).

## Screen layout (state 2026-11-20, version 0.4.0)

The interface shows the essentials first and folds details away:

- Tabs in the order of the monthly work: **Plan · Wünsche · Termine · Auswertung**, then the
  tabs that change rarely: **Personen · Regeln · Einstellungen**.
- **Plan:** month, one main button ("Plan erstellen" / "Neu erstellen"), "Für Excel kopieren", "Excel-Datei", a status line
  (status, deadline, number of unmet rules) and "Weitere Optionen" (computing time, keep existing
  duties, status, print, clear). Below: collapsible sections, each a single line with a
  summary until opened: "Regelprüfung" (rule check), "Nur für <Monat>" (month settings),
  the plan itself, "Stunden" (hours per week).
- **Regeln:** every rule as one sentence in five collapsed groups (Besetzung, Arbeitszeit,
  Wochenende, Wünsche und Rhythmus, Ausgleich). Each rule has an importance level
  "aus · wenig · normal · wichtig · sehr wichtig" (weight = default weight × 0 / 0.3 / 1 / 3 / 10)
  or "gilt immer" for hard rules. Exact weights: group "Genaue Gewichte".
- **Einstellungen:** duty times per weekday, closed days, general settings, data and privacy
  (backup, templates, erase).

## Monthly workflow

The plan for month M is due on day `deadlineDay` (default 4) of month M−1. The app opens the
following month by default.

1. **Wünsche** (reworked 2026-11-20, version 0.8.0): per person (buttons at the top), everything
   that can be entered is visible at once as a short text; a click on an item opens its editor.
   - The month as a calendar: every day shows its entries ("nicht bis 12", "eher nicht ab 20",
     "ganzer Tag nicht", "möchte 14–17", "abwesend · Urlaub", appointments). A click opens the
     day editor: whole day impossible, a time range ("kann nicht von 12 bis 14"), or single half
     hours with a brush ("cannot work" is hard, "rather not" soft, "wants to work" preferred,
     "can (exception)" overrides the weekly pattern). Entries inherited from the weekly pattern
     are shown lighter. On a phone the calendar becomes a list of days.
   - The weekly pattern (valid every month, same editor); weekly wishes such as "once a week a
     duty that starts in the morning" and absences (vacation) as lists; a click opens a form.
   Texts of the entries: `src/js/wishtext.js` (tested in `tests/wishtext.test.mjs`).
2. **Termine:** one-off appointments of the month (for example a case conference) with participants.
3. **Plan → "Einstellungen nur für <Monat>"** (month settings, stored in `monthSettings['YYYY-MM']`,
   they change nothing outside that month): no morning duties for everybody or for single persons
   (morning = start before a time, default 12:00; appointments still take place), weekly wishes
   paused per person, other weekly hours per person.
4. **Plan:** choose the computing time and press "Plan erstellen". "schnell" is one optimizer run
   (about 3 s); "bis alle Regeln erfüllt, höchstens 20 s / 1 min / 3 min" (default 1 min, measured
   1–3 % above the best possible plan, see `docs/generator.md`) repeats the search
   (new random starts and restarts from the best plan) until every rule of the evaluation is met
   or the time is up; "Beenden und beste Lösung übernehmen" stops early. The best plan is the one
   with the lowest weighted cost.
   Below the month settings, **"Regelprüfung"** (rule check) lists the rules the plan does not
   fully meet, each with its weight: raise a weight (or press "×2") and press "Mit diesen
   Gewichten neu erstellen" to favour that rule; other rules then give way. It also lists what no
   plan can avoid (lower bounds, see `docs/generator.md`), for example duties on consecutive days
   for 25 h/week with at most 6-hour duties; those do not count as violations.
   **"Varianten"** (variants): the search keeps up to three further plans that are at most 10 %
   worse and differ in at least 6 person-days; each shows a profile (Fridays, late duties,
   weekend day per person) and its unmet rules; "Übernehmen" exchanges it with the shown plan.
   **Duty editor → "Vorschläge"** (suggestions): clicking a duty lists ranked changes for the whole
   plan (other times, no duty, hand over to or take over from a colleague, exchange times on the
   same day, trade days with a colleague, move to another day of the week), each marked
   "besser / gleich gut / schlechter" with points (weighted rule deviations). Only changes
   without a hard-rule violation are offered; "Rückgängig" undoes them.
   Then adjust duties by clicking a lane (timeline) or a cell
   (calendar); "Fixieren" keeps a duty. Two views, switch "Zeitleiste | Kalender":
   - Zeitleiste: one row per day, one lane per person, bars over the hours.
   - Kalender: month grid like a calendar app, columns Mon–Sun, one row group per week with one
     row per person; cells show the duty times as numbers (for example `14–19`), a superscript
     letter marks an appointment, the last column shows worked / target hours of the week.
   Status "Wünsche sammeln → Entwurf → Abgeschlossen".
5. **Auswertung:** shows how well the plan meets every rule and how fair it is (see below).
6. Exports (state 2026-11-20, version 0.7.0):
   - **"Für Excel kopieren"** puts the plan as a plain table on the clipboard, for pasting into an
     existing Excel template whose layout the app does not know: one row per person, one column
     per day, each cell only the duty time ("14–19"). Options, kept in `ui.gridOpts`: header
     (weekday and date in two rows, in one row, or none), all days or without weekend days, time
     format "14–19" or "14:00–19:00", names in the first column. In the template, click the top
     left target cell and paste; the template keeps its formatting. A preview shows the table.
   - **"Excel-Datei"**: sheet 1 laid out like the calendar view (columns Mon–Sun, one block per
     week, weekly hours in the last column, rule violations red), sheet 2 "Zum Einfügen" (the
     same table as "Für Excel kopieren"), sheet 3 "Daten" (one row per duty: date, weekday,
     person, start, end, hours; for templates that look values up with formulas). It replaces
     the CSV export (removed in 0.7.0).
   - Print (A4 landscape) under "Weitere Optionen"; calendar file (.ics) per person in the
     section "Stunden".

## Evaluation tab ("Auswertung")

Code: `src/js/report.js` (calculation, tested in `tests/report.test.mjs`), `src/js/view-report.js` (view).

- **Rule report:** every rule with result (● met, ◐ partly = at least 90 %, ○ violated, – not
  applicable) and "met of total" (for example 15 of 15 appointments covered, 138 of 138 coverage
  person-hours). Three groups: always to keep (hard: cannot-work hours, appointments, duty times,
  late rule), goals and wishes (coverage, weekly hours, weekend duty, rather-not, weekly wishes,
  preferred weekdays, alignment, lengths, …), balance between persons (contract hours, Fridays
  with previous months, weekend duties, late duties, shared time). A score card sums up the counts.
- **Distribution per person:** duties, hours actual / target, contract fulfilment, average length,
  morning duties, late duties, balance weekdays (month / total), weekend duties, consecutive days,
  appointment-only duties; highest value underlined, lowest in italics, last row shows the range.
- **Who works with whom:** matrix with shared hours and number of days per pair.
- **Duties per weekday** per person (balance weekdays highlighted).

## Glossary

| Term | Meaning |
| --- | --- |
| Duty ("Dienst") | One working block of a person on one day, free start and end on a 30-minute grid. |
| Coverage ("Besetzung") | Time window per weekday with a minimum number of persons present, for example Mon–Fri 14:00–20:00, 1 person. |
| Weekly coverage | A window that must be covered on n days per week, day chosen freely (for example once a week until 21:00). |
| Appointment ("Termin") | Weekly (team meeting) or one-off; every participant's duty that day must contain it, as one block. |
| Appointment-only duty | A duty that consists only of the appointment (shorter than the person's minimum length); limited per month. |
| Wish string | 48 characters per day, one per half hour: `.` none, `x` cannot, `-` rather not (soft), `+` wants, `o` can (exception). |
| Weekly wish | Per person: on n days per week a duty that starts inside a window (for example 10:00–13:00 = morning). Soft; only for weeks with at least 3 possible workdays. |
| Alignment | Regeln → Ausgleich: duties of the same day and the same group (morning = starts before 13:00, afternoon) should start together, end together, either, or both. Soft. |
| Balance weekdays | Weekdays (default Friday) whose duties are spread evenly across persons, including previous months. |
| Late rule | After a duty ending after 20:30 the next day's duty starts at 13:00 at the earliest (configurable). |
| Normal span | 10:00–21:00 (Einstellungen → duty times per weekday and display range). Duties entered by hand and appointments may lie outside (for example from 07:30); the views widen automatically and mark such duties. The generator plans only inside the duty times of the weekday, except to include an appointment. |

## How the first team's requirements are represented (state 2026-11-20)

| Requirement | Setting |
| --- | --- |
| Mon–Fri 14:00–20:00 someone present | Regeln → coverage |
| Once a week someone until 21:00 | Regeln → weekly coverage 20:00–21:00, 1 day |
| J1, J2: 15 h/week as 3 × 5 h, ideally Mon/Wed/Fri, not on consecutive days | People: 15 h, length 5–5, preferred days, "avoid consecutive" |
| N: 25 h/week, 6-hour duties preferred | People: 25 h, length 5–6, preferred 6 |
| One person: Wednesday from 16:30, Friday until 18:00 | Wishes → weekly pattern (J2 in `tests/fixture.mjs`) |
| No morning duties on Wednesday | Einstellungen → duty times Wednesday from 12:00 |
| Fridays balanced per month and across months | Regeln → balance weekdays Friday, 3 months of history |
| Everybody one 3-hour weekend duty per month, preferably ending by 20:00; counts as working time | Regeln → weekend |
| At most one weekend per month without any duty | Regeln → weekend, "at most 1" |
| Tuesday 14:00–15:30 team meeting, everyone, inside the duty | Termine → weekly appointment |
| Coming in only for the meeting at most once a month | Regeln → appointment-only duties ≤ 1 |
| Case conference in the morning, varying persons, one block with the duty | Termine → one-off appointment |
| Shared working time balanced between all persons | Weight "shared time" |
| "Cannot work" wishes are hard (override only after talking to the person: edit by hand) | Wishes → "Kann nicht" |
| Whole days impossible | Wishes → day chips |
| Once a week a morning duty (per person) | Wishes → weekly wish |
| "Rather not on Friday until 21:00" | Wishes → brush "Eher nicht" in the weekly pattern |
| Morning or afternoon duties start / end at the same time | Regeln → simultaneous start or end |
| After a duty until 21:00 no start before 13:00 next day | Regeln → late rule |
| No morning duties in a given month (for everybody or one person) | Plan → month settings |
| No duty on the day before and the day after a vacation, so the time off is as long as possible | Wishes → absences; weight "day before or after an absence" (soft) |
| Rules that cannot all be met at once: search longer, then weight them | Plan → computing time "bis alle Regeln erfüllt"; Regelprüfung → weights |

## Code map

| File | Purpose |
| --- | --- |
| `src/js/model.js` | State shape (schema 2), neutral defaults (`PRESETS.blank`). |
| `src/js/scheduler.js` | Candidate duties, cost function, optimizer, analysis. Authoritative for rule semantics. |
| `src/js/report.js` | Evaluation of a plan: rule report, lower bounds (`structuralBounds`), fairness figures, pairs, weight of each rule (`weightFor`). |
| `src/js/search.js` | Repeated optimizer runs with a time limit, early stop when every rule is met, pool of variants. |
| `src/js/suggest.js` | Ranked suggestions for one duty (times, swaps, trades, moves) and their effect on the plan. |
| `src/js/wishtext.js` | Short texts of the wishes of a day ("nicht bis 12"), used by the wishes view. |
| `src/js/exporters.js` | Table for pasting into a template (`planToGrid`), list of duties, iCalendar, Excel file (three sheets). |
| `src/js/xlsx.js` | Minimal .xlsx writer (ZIP without compression, one or more sheets, styles); no library. |
| `src/js/view-rules.js` | Rules tab: rules as sentences, importance levels. |
| `src/js/store.js` | localStorage persistence. |
| `src/js/view-*.js`, `app.js`, `ui-core.js` | UI (plan timeline, wishes grid, appointments, people, setup, data). |
| `build.mjs` | Concatenates the modules into `dist/dienstplaner.html`; fails on duplicate top-level names. |
| `tests/scheduler.test.mjs` | Scenario tests (the first team's rules). |
| `tests/suggest.test.mjs` | Suggestions and variants. |
| `tests/wishtext.test.mjs` | Texts of day wishes. |
| `tests/xlsx.test.mjs` | ZIP writer and Excel export. |
| `tests/month-search.test.mjs` | Month settings, vacation edges, lower bounds, time-limited search. |
| `docs/generator.md` | How the generator works, measured distance to the optimum. |
| `tools/exact/` | Developer tool: exact model (OR-Tools CP-SAT) to measure the distance of the app's plans to the optimum. Not part of the app. |

## Open questions (state 2026-11-20)

| No. | Question | Options | Decided by |
| --- | --- | --- | --- |
| 1 | Do the weekly hours count per calendar week exactly, or may they even out within the month? | Currently: soft target per week, prorated for partial weeks at the month border. | The planner |
| 2 | Do public holidays reduce the target hours? | Currently: closed days reduce the target. | The planner / employer |
| 3 | Is browser storage plus manual backup enough? | Alternative: open/save a local file (File System Access API, Chromium only). | The planner |
| 4 | Breaks: are 6-hour duties allowed without a break, are longer duties (appointment days) given a break? | Not modelled; duties up to `maxDayHours`. | The planner / employer |
