# Generator (hour model)

What it is for: building the monthly duty plan under the configured rules.
Code: `src/js/scheduler.js`. Tests: `tests/scheduler.test.mjs`. State: 2026-11-20 (schema 2).

## Decision variables

For each person p and day d the generator chooses one candidate duty or "off".
Candidates (`candidatesFor`): every start on the 30-minute grid inside the day window, with a
length from the person's minimum to maximum (weekend: exactly the weekend duty length), that does
not touch a "cannot work" half hour. If the person has appointments that day, only candidates that
contain all of them are allowed, "off" is forbidden, and two extra lengths exist: the appointment
span alone ("appointment-only duty") and, if the appointments span more than the maximum length,
longer duties up to `maxDayHours`.

## Hard rules

Contained in the candidates: cannot-work hours, absences, day windows, lengths, appointments.
Checked during the search: the late rule (duty ends after `lateRule.endAfter` → next duty starts
at `lateRule.nextFrom` or later; also across the month border). Duties entered by hand and
fixed duties are never changed, even if they break a rule; the analysis reports them.

## Cost (weights in Setup → Gewichtung)

| Term | Measure |
| --- | --- |
| coverage | missing persons per half hour in coverage windows |
| weeklyCoverage | weeks in which fewer than `days` days cover the window |
| hours | per week: absolute difference between worked and target hours; target = weekly hours × workdays of the week in this month (minus absences and closed days) / number of workdays |
| weekend | difference between weekend duties and `weekendDuty.perMonth` |
| weekendLate | half hours of weekend duties after `avoidAfter` |
| apptOnly | appointment-only duties above `appointmentOnlyMax` |
| length | half hours of difference to the preferred length (weekdays) |
| outside | half hours of weekday duties outside any coverage window |
| prefDay | weekday duty on a non-preferred weekday (days with appointments excepted) |
| consecutive | duties on two consecutive days, for persons with "avoid consecutive" |
| rather | half hours of a duty inside a "rather not" (`-`) wish |
| weeklyWish | per person and week, missing duties that start inside the wish window |
| align | per day and group (morning / afternoon): spread in half hours between starts and/or ends, depending on the mode |
| want | a day with "wants to work" without duty |
| emptyWeekend | weekends without any duty above `maxEmptyWeekends` |
| balanceDay | sum of squared differences from the mean of duties on balance weekdays (this month + previous `balanceHistoryMonths`) |
| pairs | sum of squared differences from the mean of shared hours per pair of persons |
| lateBalance | sum of squared differences from the mean number of late duties (end after `lateRule.endAfter`) per active person |
| vacation | duty on the day directly before or after an absence (vacation) |

Month settings (`monthSettings['YYYY-MM']`, model.js `monthSettingsOf`) are applied in
`buildProblem`: each person becomes an effective copy with the month's weekly hours, without
weekly wishes when they are paused, and with `minStart` (no candidate duty starts earlier, except
that appointments still widen the window). The stored person is not changed.

## Method

1. Greedy improvement: three passes over all free cells in random order, each cell takes its best option.
2. Simulated annealing for the time budget (temperature 60 → 0.5): change one cell (often a
   nearby time), move a duty of a person to another day of the same week, or hand a day over to
   another person. A move that adds hard-rule violations is rejected. The best plan seen is kept.
3. Runs in steps (`step(ms)`) so the page stays responsive.
4. Time-limited search (`search.js`, `createSearch`): optimizer runs of 3 s (6 s for limits of
   1 min and more); every second run restarts from the best plan so far at temperature 15, the
   others start fresh with a new seed. After each run the plan is evaluated (`buildReport`); the
   search stops when no rule has status warn or bad, when the time limit is reached, or when the
   user stops it. The plan with the lowest weighted cost is kept, so the weights decide which rule
   gives way when not all can be met.

## Lower bounds (report.js `structuralBounds`)

Some soft rules cannot be met completely by any plan. Per person and week, every set of weekdays
that contains the days with appointments or locked duties and can reach the weekly hours
(within 1 hour, or as close as the possible duty lengths allow) is tried; the smallest number of
consecutive-day pairs and of duties on non-preferred weekdays over these sets are lower bounds.
The smallest reachable distance to the weekly target is computed from the candidate duty
lengths of each day. Weekend duties and pairs across week borders are left out, so the values
stay lower bounds. The rule report counts only what exceeds them as violated and lists the bounds
as hints. Example (backup of 2026-11-20, December 2026): N with 25 h/week and 5–6-hour duties
has at least 12 duties on consecutive days; J1 and J2 at least 3–4 each.

## Measured (2026-11-20)

Preset "Nachmittagsdienst, 3 Personen", December 2026, budget 3 s: coverage Mon–Fri 14–20 without
gap, every Tuesday all three in the meeting, one 3-hour weekend duty each, at most one empty
weekend, Fridays 3/3/3, shared hours 22/22/22, monthly hours within a few hours of the target.

## Limits

- No proof of optimality; on tight months a longer time limit helps.
- The lower bounds treat each rule on its own. Rules can also conflict with each other (for
  example fixed 5-hour duties, one weekend duty and the weekly hours); such conflicts show up as
  rules that stay unmet after the full time limit, and the weights decide between them.
- History: balance weekdays count the previous months' stored plans; the late rule looks at the
  last day of the previous month. Weekly hours do not carry over between months.
