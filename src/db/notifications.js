const db = require('./index');

// Every template below describes a REAL event with real names/numbers.
// The randomness is only in which honestly-worded phrasing gets picked for
// that event - never in the underlying fact. This is deliberate: a student
// who catches one fabricated notification stops trusting all of them.
const TEMPLATES = {
  dailyAnswered: [
    (name, course) => `${name} just answered today's question in ${course}. Your turn.`,
    (name, course) => `${name} is already done with today's ${course} question — are you?`,
    (name, course) => `${name} just kept their streak alive in ${course}.`,
  ],
  streakMilestone: [
    (name, days) => `${name} just hit a ${days}-day streak. Where's yours?`,
    (name, days) => `${name} is on a ${days}-day streak and showing no signs of stopping.`,
    (name, days) => `${name} reached ${days} days in a row. Don't fall behind.`,
  ],
  leaderboardOvertake: [
    (name, course) => `${name} just passed you on the ${course} leaderboard.`,
    (name, course) => `You've been overtaken in ${course} — ${name} is now ahead of you.`,
    (name, course) => `${name} just moved past you in ${course}. Reclaim your spot?`,
  ],
  assignmentSubmitted: [
    (name, title, course) => `${name} just submitted ${title} in ${course}.`,
    (name, title, course) => `${name} turned in ${title} in ${course}. Have you?`,
  ],
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

const insertNotification = db.prepare(
  'INSERT INTO notifications (student_id, message, course_id) VALUES (?, ?, ?)'
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

// A classmate answered a daily question - notify the rest of the course
// (not the student who just answered).
function notifyDailyAnswered(courseId, actorId, actorName, courseCode) {
  const template = pick(TEMPLATES.dailyAnswered);
  const message = template(actorName, courseCode);
  coursemates(courseId, actorId).forEach((sid) => {
    insertNotification.run(sid, message, courseId);
  });
}

// A student reached a streak milestone (every 5 days) - notify classmates
// in every course they're enrolled in.
function notifyStreakMilestone(actorId, actorName, streakDays) {
  if (streakDays === 0 || streakDays % 5 !== 0) return;
  const courseIds = db.prepare('SELECT course_id FROM enrollments WHERE student_id = ?').all(actorId).map((r) => r.course_id);
  const template = pick(TEMPLATES.streakMilestone);
  const message = template(actorName, streakDays);
  const notified = new Set();
  courseIds.forEach((cid) => {
    coursemates(cid, actorId).forEach((sid) => {
      if (notified.has(sid)) return;
      notified.add(sid);
      insertNotification.run(sid, message, cid);
    });
  });
}

// An assignment was submitted - notify the rest of the course, without
// revealing the grade.
function notifyAssignmentSubmitted(courseId, actorId, actorName, assignmentTitle, courseCode) {
  const template = pick(TEMPLATES.assignmentSubmitted);
  const message = template(actorName, assignmentTitle, courseCode);
  coursemates(courseId, actorId).forEach((sid) => {
    insertNotification.run(sid, message, courseId);
  });
}

// If the acting student's daily-question streak just moved them ahead of
// someone in a course's leaderboard ranking, tell the student(s) they passed.
function notifyLeaderboardOvertakes(courseId, actorId, actorName, courseCode, previousRanks, currentRanks) {
  const template = pick(TEMPLATES.leaderboardOvertake);
  const actorNewRank = currentRanks[actorId];
  if (actorNewRank === undefined) return;

  Object.keys(previousRanks).forEach((sidStr) => {
    const sid = Number(sidStr);
    if (sid === actorId) return;
    const before = previousRanks[sid];
    const after = currentRanks[sid];
    if (before === undefined || after === undefined) return;
    // The other student's rank number got worse (higher = lower rank) AND
    // the actor is now above them - a genuine overtake, not just any change.
    if (after > before && currentRanks[actorId] < after) {
      insertNotification.run(sid, template(actorName, courseCode), courseId);
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

module.exports = {
  notifyDailyAnswered,
  notifyStreakMilestone,
  notifyAssignmentSubmitted,
  notifyLeaderboardOvertakes,
  unreadCount,
  recentNotifications,
  markAllRead,
};
