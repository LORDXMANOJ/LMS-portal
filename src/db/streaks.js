const db = require('../db');

// All date math below uses Date.UTC explicitly and never mixes it with
// local-time Date construction (new Date('YYYY-MM-DD') parses as UTC
// midnight, but new Date('YYYY-MM-DDTHH:MM:SS') parses as LOCAL time - that
// mismatch causes an off-by-one day in any timezone ahead of UTC). Every
// date here is a plain 'YYYY-MM-DD' string; comparisons go through
// dateToUtcDays so nothing ever touches the local clock.
function dateToUtcDays(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

function todayUtcStr() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

// A streak counts consecutive calendar days (UTC) on which a student
// answered at least one daily question (any course, any type). "Still
// alive" means the most recent answered date is today or yesterday - a
// student who hasn't answered yet today shouldn't see their streak drop to
// 0 before the day is even over.
function getStreak(studentId) {
  const rows = db
    .prepare(
      `SELECT DISTINCT date(answered_at) as d FROM daily_answers
       WHERE student_id = ? ORDER BY d DESC`
    )
    .all(studentId);

  const dates = rows.map((r) => r.d);
  if (dates.length === 0) {
    return { current: 0, longest: 0, answeredToday: false, alive: false };
  }

  const todayDays = dateToUtcDays(todayUtcStr());
  const mostRecentDays = dateToUtcDays(dates[0]);
  const answeredToday = mostRecentDays === todayDays;
  const alive = mostRecentDays === todayDays || mostRecentDays === todayDays - 1;

  let current = 0;
  if (alive) {
    current = 1;
    for (let i = 1; i < dates.length; i++) {
      const gap = dateToUtcDays(dates[i - 1]) - dateToUtcDays(dates[i]);
      if (gap === 1) {
        current++;
      } else {
        break;
      }
    }
  }

  // Longest streak ever: scan the full sorted date list for the longest run
  // of consecutive days.
  let longest = 1;
  let run = 1;
  for (let i = 1; i < dates.length; i++) {
    const gap = dateToUtcDays(dates[i - 1]) - dateToUtcDays(dates[i]);
    run = gap === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  return { current, longest, answeredToday, alive };
}

module.exports = { getStreak };
