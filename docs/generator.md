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

## Method

1. Greedy improvement: three passes over all free cells in random order, each cell takes its best option.
2. Simulated annealing for the time budget (temperature 60 → 0.5): change one cell (often a
   nearby time), move a duty of a person to another day of the same week, or hand a day over to
   another person. A move that adds hard-rule violations is rejected. The best plan seen is kept.
3. Runs in steps (`step(ms)`) so the page stays responsive; budget 1.5 / 3 / 8 s.

## Measured (2026-11-20)

Preset "Nachmittagsdienst, 3 Personen", December 2026, budget 3 s: coverage Mon–Fri 14–20 without
gap, every Tuesday all three in the meeting, one 3-hour weekend duty each, at most one empty
weekend, Fridays 3/3/3, shared hours 22/22/22, monthly hours within a few hours of the target.

## Limits

- No proof of optimality; on tight months a longer budget helps.
- History: balance weekdays count the previous months' stored plans; the late rule looks at the
  last day of the previous month. Weekly hours do not carry over between months.
