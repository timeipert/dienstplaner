// Test scenario shared by the tests: three persons with afternoon duties. Not part of the app
// (the app ships only neutral defaults, see PRESETS in src/js/model.js).
//   coverage Mon–Fri 14:00–20:00 (default), once a week until 21:00, Wednesday from 12:00,
//   weekly appointment "Weekly meeting" Tuesday 14:00–15:30 with everybody,
//   J1 and J2: 15 h, duties of 5 h, preferred Mon/Wed/Fri; J1 Friday 20–21 "rather not";
//   J2 Wednesday not before 16:30 and Friday not after 18:00; N: 25 h, duties of 5–6 h.
import { newState, newPerson, blockString } from '../src/js/model.js';
import { uid } from '../src/js/util.js';

export function testState() {
  const s = newState('blank');
  const c = s.config;
  c.dayWindows[3].from = '12:00';
  c.weeklyCoverage = [{ id: uid('wc'), weekdays: [1, 2, 3, 4, 5], from: '20:00', to: '21:00', min: 1, days: 1 }];
  c.appointments = [{ id: uid('ap'), title: 'Weekly meeting', repeat: 'weekly', weekday: 2, date: '', from: '14:00', to: '15:30', participants: 'all' }];
  s.people = [
    newPerson('J1', { weeklyHours: 15, minLen: 5, maxLen: 5, prefLen: 5, preferredWeekdays: [1, 3, 5], avoidConsecutive: true, pattern: { 5: blockString(20 * 60, 21 * 60, '-') } }),
    newPerson('J2', { weeklyHours: 15, minLen: 5, maxLen: 5, prefLen: 5, preferredWeekdays: [1, 3, 5], avoidConsecutive: true, pattern: { 3: blockString(0, 16 * 60 + 30), 5: blockString(18 * 60, 24 * 60) } }),
    newPerson('N', { weeklyHours: 25, minLen: 5, maxLen: 6, prefLen: 6, avoidConsecutive: true }),
  ];
  return s;
}
