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

// Same ranking rule as the leaderboard page: streak first, then total daily
// questions answered in the course, then name. Returns { studentId: rank }
// (rank 1 = first place), used both to render the leaderboard and to detect
// when one student's answer just moved them ahead of another.
function getLeaderboardRanks(courseId) {
  const classmates = db
    .prepare(
      `SELECT u.id, u.name FROM enrollments e JOIN users u ON u.id = e.student_id
       WHERE e.course_id = ? AND u.status = 'active' ORDER BY u.name`
    )
    .all(courseId);

  const answeredCount = db.prepare(
    `SELECT COUNT(*) as c FROM daily_answers da
     JOIN daily_questions dq ON dq.id = da.daily_question_id
     WHERE dq.course_id = ? AND da.student_id = ?`
  );

  const rows = classmates.map((s) => {
    const streak = getStreak(s.id);
    const answered = answeredCount.get(courseId, s.id).c;
    return { id: s.id, name: s.name, streak: streak.current, answered };
  });

  rows.sort((a, b) => b.streak - a.streak || b.answered - a.answered || a.name.localeCompare(b.name));

  const ranks = {};
  rows.forEach((r, i) => { ranks[r.id] = i + 1; });
  return { ranks, rows };
}

module.exports = { getStreak, getLeaderboardRanks };
