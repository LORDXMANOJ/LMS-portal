const db = require('./index');

// Every template below describes a REAL event with real names. The
// randomness is only in which honestly-worded phrasing gets picked for that
// event - never in the underlying fact, and never in a number. A student who
// catches one fabricated notification stops trusting all of them.
//
// Style note: short, urgent, a little needling - the same register food
// delivery apps use to get you to open the app, aimed at studying instead
// of eating. No emoji (house rule), no invented activity.
const TEMPLATES = {
  dailyAnswered: [
    (name, course) => `${name} already finished today's ${course} question. You haven't.`,
    (name, course) => `${name}'s done with today's ${course} question. Still on your list?`,
    (name, course) => `While you were away, ${name} knocked out today's ${course} question.`,
  ],
  streakAhead: [
    (name, days) => `${name} is ${days} days deep on their streak. You're not even close.`,
    (name, days) => `${name} just hit ${days} days in a row. Yours is still shorter.`,
    (name, days) => `${name}'s streak: ${days} days. Yours: not that. Fix it today.`,
  ],
  leaderboardOvertake: [
    (name, course) => `${name} just passed you on the ${course} leaderboard.`,
    (name, course) => `You've been overtaken in ${course} — ${name} is now ahead of you.`,
    (name, course) => `${name} just moved past you in ${course}. Reclaim your spot?`,
  ],
  assignmentSubmitted: [
    (name, title, course) => `${name} already submitted ${title} in ${course}. You haven't.`,
    (name, title, course) => `${name} turned in ${title} in ${course} while you were thinking about it.`,
    (name, title, course) => `${title} — ${name} is in. You're still out, in ${course}.`,
  ],
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

const insertNotification = db.prepare(
  'INSERT INTO notifications (student_id, message, link_url, course_id) VALUES (?, ?, ?, ?)'
);

function coursemates(courseId, excludeStudentId) {
  return db
    .prepare(
      `SELECT student_id FROM enrollments e
       JOIN users u ON u.id = e.student_id
       WHERE e.course_id = ? AND e.student_id != ? AND u.status = 'active'`
    )
    .all(courseId, excludeStudentId)
    .map((r) => r.student_id);
}

// A classmate answered a daily question - notify only the coursemates who
// have NOT answered it themselves yet. Someone who's already done it isn't
// behind, so there's nothing to trigger for them.
function notifyDailyAnswered(dailyQuestionId, courseId, actorId, actorName, courseCode) {
  const alreadyAnswered = new Set(
    db.prepare('SELECT student_id FROM daily_answers WHERE daily_question_id = ?').all(dailyQuestionId).map((r) => r.student_id)
  );
  const behind = coursemates(courseId, actorId).filter((sid) => !alreadyAnswered.has(sid));
  if (behind.length === 0) return;

  const template = pick(TEMPLATES.dailyAnswered);
  const message = template(actorName, courseCode);
  const link = '/student/daily/go/' + dailyQuestionId;
  behind.forEach((sid) => insertNotification.run(sid, message, link, courseId));
}

// A student reached a streak milestone (every 5 days) - notify only
// classmates whose OWN current streak is lower. Someone already ahead or
// tied doesn't need to feel behind.
function notifyStreakMilestone(actorId, actorName, streakDays, getStreakFn) {
  if (streakDays === 0 || streakDays % 5 !== 0) return;
  const courseIds = db.prepare('SELECT course_id FROM enrollments WHERE student_id = ?').all(actorId).map((r) => r.course_id);
  const template = pick(TEMPLATES.streakAhead);
  const message = template(actorName, streakDays);

  const notified = new Set();
  courseIds.forEach((cid) => {
    coursemates(cid, actorId).forEach((sid) => {
      if (notified.has(sid)) return;
      const theirStreak = getStreakFn(sid).current;
      if (theirStreak >= streakDays) return; // not behind, skip
      notified.add(sid);
      insertNotification.run(sid, message, '/student/daily', cid);
    });
  });
}

// An assignment was submitted - notify only the coursemates who have NOT
// submitted it yet. No grade is ever mentioned.
function notifyAssignmentSubmitted(assignmentId, courseId, actorId, actorName, assignmentTitle, courseCode) {
  const alreadySubmitted = new Set(
    db.prepare('SELECT student_id FROM submissions WHERE assignment_id = ?').all(assignmentId).map((r) => r.student_id)
  );
  const behind = coursemates(courseId, actorId).filter((sid) => !alreadySubmitted.has(sid));
  if (behind.length === 0) return;

  const template = pick(TEMPLATES.assignmentSubmitted);
  const message = template(actorName, assignmentTitle, courseCode);
  const link = '/student/assignments/' + assignmentId;
  behind.forEach((sid) => insertNotification.run(sid, message, link, courseId));
}

// If the acting student's answer just moved them ahead of someone in a
// course's leaderboard ranking, tell only the specific student(s) they
// passed - this is inherently already "you're now behind."
function notifyLeaderboardOvertakes(courseId, actorId, actorName, courseCode, previousRanks, currentRanks) {
  const template = pick(TEMPLATES.leaderboardOvertake);
  const link = '/student/courses/' + courseId + '/leaderboard';

  Object.keys(previousRanks).forEach((sidStr) => {
    const sid = Number(sidStr);
    if (sid === actorId) return;
    const before = previousRanks[sid];
    const after = currentRanks[sid];
    if (before === undefined || after === undefined) return;
    if (after > before && currentRanks[actorId] < after) {
      insertNotification.run(sid, template(actorName, courseCode), link, courseId);
    }
  });
}

function unreadCount(studentId) {
  return db.prepare('SELECT COUNT(*) as c FROM notifications WHERE student_id = ? AND read_at IS NULL').get(studentId).c;
}

function recentNotifications(studentId, limit) {
  return db
    .prepare('SELECT * FROM notifications WHERE student_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(studentId, limit || 15);
}

function markAllRead(studentId) {
  db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE student_id = ? AND read_at IS NULL").run(studentId);
}

function markRead(notificationId, studentId) {
  db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND student_id = ?").run(notificationId, studentId);
}

module.exports = {
  notifyDailyAnswered,
  notifyStreakMilestone,
  notifyAssignmentSubmitted,
  notifyLeaderboardOvertakes,
  unreadCount,
  recentNotifications,
  markAllRead,
  markRead,
};
