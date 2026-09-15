const db = require('./index');

const insertActivity = db.prepare(
  'INSERT INTO activity_log (user_id, course_id, type, description) VALUES (?, ?, ?, ?)'
);

function logActivity(userId, courseId, type, description) {
  insertActivity.run(userId, courseId || null, type, description);
}

module.exports = { logActivity };
