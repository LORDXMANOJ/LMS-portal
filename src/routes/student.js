const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { logActivity } = require('../db/activity');
const { gradeMcq } = require('../db/grading');
const { getStreak } = require('../db/streaks');
const { groupByWeek } = require('../utils/weeks');

const router = express.Router();
router.use(requireRole('student'));

// Available as `streak` in every student view (nav bar badge, dashboard tile).
router.use((req, res, next) => {
  res.locals.streak = getStreak(req.session.user.id);
  next();
});

const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const safe = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safe);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// Dashboard: pending work, recent activity, progress
router.get('/', (req, res) => {
  const studentId = req.session.user.id;

  const courses = db
    .prepare(
      `SELECT c.*, u.name as faculty_name
       FROM courses c
       JOIN enrollments e ON e.course_id = c.id
       LEFT JOIN users u ON u.id = c.faculty_id
       WHERE e.student_id = ?
       ORDER BY c.code`
    )
    .all(studentId);

  const courseIds = courses.map((c) => c.id);
  let pendingAssignments = [];
  let recentAnnouncements = [];
  let courseProgress = [];

  if (courseIds.length > 0) {
    const placeholders = courseIds.map(() => '?').join(',');

    pendingAssignments = db
      .prepare(
        `SELECT a.*, c.code as course_code, c.title as course_title,
                s.id as submission_id, s.status as submission_status
         FROM assignments a
         JOIN courses c ON c.id = a.course_id
         LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
         WHERE a.course_id IN (${placeholders})
         ORDER BY a.due_date ASC`
      )
      .all(studentId, ...courseIds);

    recentAnnouncements = db
      .prepare(
        `SELECT an.*, c.code as course_code
         FROM announcements an
         JOIN courses c ON c.id = an.course_id
         WHERE an.course_id IN (${placeholders})
         ORDER BY an.created_at DESC
         LIMIT 5`
      )
      .all(...courseIds);

    courseProgress = courses.map((c) => {
      const total = db
        .prepare('SELECT COUNT(*) as c FROM assignments WHERE course_id = ?')
        .get(c.id).c;
      const done = db
        .prepare(
          `SELECT COUNT(*) as c FROM submissions s
           JOIN assignments a ON a.id = s.assignment_id
           WHERE a.course_id = ? AND s.student_id = ?`
        )
        .get(c.id, studentId).c;
      return {
        ...c,
        total,
        done,
        percent: total > 0 ? Math.round((done / total) * 100) : 0,
      };
    });
  }

  const pending = pendingAssignments.filter((a) => !a.submission_id);
  const submitted = pendingAssignments.filter((a) => a.submission_id);

  const recentActivity = db
    .prepare('SELECT * FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 8')
    .all(studentId);

  res.render('student/dashboard', {
    title: 'Dashboard',
    courses,
    pending,
    submitted,
    recentAnnouncements,
    courseProgress,
    recentActivity,
  });
});

// Calendar/timeline of all due dates across enrolled courses
router.get('/calendar', (req, res) => {
  const studentId = req.session.user.id;
  const courses = db
    .prepare('SELECT course_id FROM enrollments WHERE student_id = ?')
    .all(studentId);
  const courseIds = courses.map((c) => c.course_id);

  let assignments = [];
  if (courseIds.length > 0) {
    const placeholders = courseIds.map(() => '?').join(',');
    assignments = db
      .prepare(
        `SELECT a.*, c.code as course_code,
                s.id as submission_id, s.status as submission_status
         FROM assignments a
         JOIN courses c ON c.id = a.course_id
         LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
         WHERE a.course_id IN (${placeholders})
         ORDER BY a.due_date ASC`
      )
      .all(studentId, ...courseIds);
  }

  res.render('student/calendar', { title: 'Calendar', assignments });
});

// Course detail: materials, assignments, announcements
router.get('/courses/:id', (req, res) => {
  const studentId = req.session.user.id;
  const courseId = req.params.id;

  const enrolled = db
    .prepare('SELECT 1 FROM enrollments WHERE course_id = ? AND student_id = ?')
    .get(courseId, studentId);
  if (!enrolled) {
    return res.status(403).render('error', {
      title: 'Access denied',
      message: 'You are not enrolled in this course.',
    });
  }

  const course = db.prepare('SELECT c.*, u.name as faculty_name FROM courses c LEFT JOIN users u ON u.id = c.faculty_id WHERE c.id = ?').get(courseId);
  const materials = db.prepare('SELECT * FROM materials WHERE course_id = ? ORDER BY week_number ASC, created_at DESC').all(courseId);
  const assignments = db
    .prepare(
      `SELECT a.*, s.id as submission_id, s.status as submission_status, s.grade, s.submitted_at
       FROM assignments a
       LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
       WHERE a.course_id = ?
       ORDER BY a.week_number ASC, a.due_date ASC`
    )
    .all(studentId, courseId);
  const announcements = db
    .prepare('SELECT * FROM announcements WHERE course_id = ? ORDER BY created_at DESC')
    .all(courseId);

  res.render('student/course', {
    title: course.code,
    course,
    weeks: groupByWeek(materials, assignments),
    announcements,
  });
});

// Course leaderboard: rank every enrolled student by daily-question streak,
// so classmates can see where they stand. Ties broken by total daily
// questions answered in this course.
router.get('/courses/:id/leaderboard', (req, res) => {
  const studentId = req.session.user.id;
  const courseId = req.params.id;

  const enrolled = db
    .prepare('SELECT 1 FROM enrollments WHERE course_id = ? AND student_id = ?')
    .get(courseId, studentId);
  if (!enrolled) {
    return res.status(403).render('error', {
      title: 'Access denied',
      message: 'You are not enrolled in this course.',
    });
  }

  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);

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
    return { id: s.id, name: s.name, streak: streak.current, answered, isMe: s.id === studentId };
  });

  rows.sort((a, b) => b.streak - a.streak || b.answered - a.answered || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.rank = i + 1; });

  res.render('student/leaderboard', { title: 'Leaderboard: ' + course.code, course, rows });
});

// Assignment detail + submission form
router.get('/assignments/:id', (req, res) => {
  const studentId = req.session.user.id;
  const assignment = db
    .prepare(
      `SELECT a.*, c.code as course_code, c.title as course_title, c.id as course_id
       FROM assignments a JOIN courses c ON c.id = a.course_id
       WHERE a.id = ?`
    )
    .get(req.params.id);

  if (!assignment) {
    return res.status(404).render('error', { title: 'Not found', message: 'Assignment not found.' });
  }

  const enrolled = db
    .prepare('SELECT 1 FROM enrollments WHERE course_id = ? AND student_id = ?')
    .get(assignment.course_id, studentId);
  if (!enrolled) {
    return res.status(403).render('error', { title: 'Access denied', message: 'You are not enrolled in this course.' });
  }

  const submission = db
    .prepare('SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?')
    .get(assignment.id, studentId);

  const rawQuestions = db
    .prepare('SELECT * FROM questions WHERE assignment_id = ? ORDER BY position ASC, id ASC')
    .all(assignment.id);
  const mcqQuestions = rawQuestions
    .filter((q) => q.type === 'mcq')
    .map((q) => ({
      ...q,
      // never send is_correct to the student
      options: db.prepare('SELECT id, option_text FROM question_options WHERE question_id = ? ORDER BY position ASC, id ASC').all(q.id),
    }));
  const programQuestions = rawQuestions
    .filter((q) => q.type === 'program')
    .map((q) => ({
      ...q,
      testCases: db.prepare('SELECT * FROM question_test_cases WHERE question_id = ? ORDER BY position ASC, id ASC').all(q.id),
    }));

  let answersByQuestion = {};
  let selectedByQuestion = {};
  if (submission) {
    const answers = db.prepare('SELECT * FROM answers WHERE submission_id = ?').all(submission.id);
    answers.forEach((a) => { answersByQuestion[a.question_id] = a; });
    const selections = db
      .prepare(
        `SELECT ans.question_id, sel.question_option_id FROM answer_selections sel
         JOIN answers ans ON ans.id = sel.answer_id WHERE ans.submission_id = ?`
      )
      .all(submission.id);
    selections.forEach((s) => {
      if (!selectedByQuestion[s.question_id]) selectedByQuestion[s.question_id] = new Set();
      selectedByQuestion[s.question_id].add(s.question_option_id);
    });
  }

  res.render('student/assignment', {
    title: assignment.title,
    assignment,
    submission,
    mcqQuestions,
    programQuestions,
    answersByQuestion,
    selectedByQuestion,
    error: null,
  });
});

// Submit answers for a question-based assignment (MCQ auto-graded, program stored for review)
router.post('/assignments/:id/answer', (req, res) => {
  const studentId = req.session.user.id;
  const assignmentId = req.params.id;

  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId);
  if (!assignment) {
    return res.status(404).render('error', { title: 'Not found', message: 'Assignment not found.' });
  }

  const enrolled = db
    .prepare('SELECT 1 FROM enrollments WHERE course_id = ? AND student_id = ?')
    .get(assignment.course_id, studentId);
  if (!enrolled) {
    return res.status(403).render('error', { title: 'Access denied', message: 'You are not enrolled in this course.' });
  }

  const questions = db.prepare('SELECT * FROM questions WHERE assignment_id = ?').all(assignmentId);
  if (questions.length === 0) {
    return res.redirect('/student/assignments/' + assignmentId);
  }

  const isLate = new Date() > new Date(assignment.due_date + 'T23:59:59');

  let submission = db
    .prepare('SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?')
    .get(assignmentId, studentId);

  if (submission) {
    db.prepare(
      `UPDATE submissions SET submitted_at = datetime('now'), status = ? WHERE id = ?`
    ).run(isLate ? 'late' : 'submitted', submission.id);
  } else {
    const result = db
      .prepare(`INSERT INTO submissions (assignment_id, student_id, status) VALUES (?, ?, ?)`)
      .run(assignmentId, studentId, isLate ? 'late' : 'submitted');
    submission = { id: result.lastInsertRowid };
  }

  const upsertAnswer = db.prepare(
    `INSERT INTO answers (submission_id, question_id, code_answer, is_correct, points_awarded)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(submission_id, question_id) DO UPDATE SET
       code_answer = excluded.code_answer,
       is_correct = excluded.is_correct,
       points_awarded = excluded.points_awarded,
       answered_at = datetime('now')`
  );
  const getAnswerId = db.prepare('SELECT id FROM answers WHERE submission_id = ? AND question_id = ?');
  const clearSelections = db.prepare('DELETE FROM answer_selections WHERE answer_id = ?');
  const insertSelection = db.prepare('INSERT INTO answer_selections (answer_id, question_option_id) VALUES (?, ?)');

  let hasMcq = false;

  const tx = db.transaction(() => {
    questions.forEach((q) => {
      if (q.type === 'mcq') {
        hasMcq = true;
        const options = db.prepare('SELECT id, is_correct FROM question_options WHERE question_id = ?').all(q.id);
        const correctIds = options.filter((o) => o.is_correct).map((o) => o.id);
        const selectedIds = [].concat(req.body['mcq_' + q.id] || []).map(Number).filter((n) => !Number.isNaN(n));
        const isCorrect = gradeMcq(selectedIds, correctIds) ? 1 : 0;
        const pointsAwarded = isCorrect ? q.points : 0;

        upsertAnswer.run(submission.id, q.id, null, isCorrect, pointsAwarded);
        const answerId = getAnswerId.get(submission.id, q.id).id;
        clearSelections.run(answerId);
        selectedIds.forEach((optId) => insertSelection.run(answerId, optId));
      } else {
        const code = req.body['program_' + q.id];
        const existingAnswer = db
          .prepare('SELECT * FROM answers WHERE submission_id = ? AND question_id = ?')
          .get(submission.id, q.id);
        upsertAnswer.run(
          submission.id,
          q.id,
          code !== undefined ? code : (existingAnswer ? existingAnswer.code_answer : ''),
          null,
          existingAnswer ? existingAnswer.points_awarded : null
        );
      }
    });
  });
  tx();

  if (hasMcq) {
    const currentAutoScore = db
      .prepare('SELECT SUM(points_awarded) as total FROM answers a JOIN questions q ON q.id = a.question_id WHERE a.submission_id = ? AND q.type = ?')
      .get(submission.id, 'mcq').total || 0;
    db.prepare('UPDATE submissions SET auto_score = ? WHERE id = ?').run(currentAutoScore, submission.id);
  }

  logActivity(studentId, assignment.course_id, 'submitted', `Submitted ${assignment.title}`);
  res.redirect('/student/assignments/' + assignmentId);
});

router.post('/assignments/:id/submit', upload.single('file'), (req, res) => {
  const studentId = req.session.user.id;
  const assignmentId = req.params.id;
  const { content } = req.body;

  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId);
  if (!assignment) {
    return res.status(404).render('error', { title: 'Not found', message: 'Assignment not found.' });
  }

  const enrolled = db
    .prepare('SELECT 1 FROM enrollments WHERE course_id = ? AND student_id = ?')
    .get(assignment.course_id, studentId);
  if (!enrolled) {
    return res.status(403).render('error', { title: 'Access denied', message: 'You are not enrolled in this course.' });
  }

  const isLate = new Date() > new Date(assignment.due_date + 'T23:59:59');
  const filePath = req.file ? '/uploads/' + req.file.filename : null;

  const existing = db
    .prepare('SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?')
    .get(assignmentId, studentId);

  if (existing) {
    db.prepare(
      `UPDATE submissions SET content = ?, file_path = COALESCE(?, file_path),
       submitted_at = datetime('now'), status = ? WHERE id = ?`
    ).run(content || null, filePath, isLate ? 'late' : 'submitted', existing.id);
    logActivity(studentId, assignment.course_id, 'resubmitted', `Updated submission for ${assignment.title}`);
  } else {
    db.prepare(
      `INSERT INTO submissions (assignment_id, student_id, content, file_path, status)
       VALUES (?, ?, ?, ?, ?)`
    ).run(assignmentId, studentId, content || null, filePath, isLate ? 'late' : 'submitted');
    logActivity(studentId, assignment.course_id, 'submitted', `Submitted ${assignment.title}`);
  }

  res.redirect('/student/assignments/' + assignmentId);
});

// Search across courses, materials, assignments
router.get('/search', (req, res) => {
  const studentId = req.session.user.id;
  const q = (req.query.q || '').trim();
  let materials = [];
  let assignments = [];
  let courses = [];

  if (q.length > 0) {
    const like = `%${q}%`;
    courses = db
      .prepare(
        `SELECT c.* FROM courses c
         JOIN enrollments e ON e.course_id = c.id
         WHERE e.student_id = ? AND (c.title LIKE ? OR c.code LIKE ?)`
      )
      .all(studentId, like, like);

    materials = db
      .prepare(
        `SELECT m.*, c.code as course_code FROM materials m
         JOIN enrollments e ON e.course_id = m.course_id
         JOIN courses c ON c.id = m.course_id
         WHERE e.student_id = ? AND (m.title LIKE ? OR m.content LIKE ?)`
      )
      .all(studentId, like, like);

    assignments = db
      .prepare(
        `SELECT a.*, c.code as course_code FROM assignments a
         JOIN enrollments e ON e.course_id = a.course_id
         JOIN courses c ON c.id = a.course_id
         WHERE e.student_id = ? AND (a.title LIKE ? OR a.description LIKE ?)`
      )
      .all(studentId, like, like);
  }

  res.render('student/search', { title: 'Search', q, courses, materials, assignments });
});

// Daily practice questions: everything scheduled today or earlier, across
// all enrolled courses. Shown one at a time, ?i= selects which one, oldest
// released first so working through them in order makes sense.
router.get('/daily', (req, res) => {
  const studentId = req.session.user.id;
  const courses = db.prepare('SELECT course_id FROM enrollments WHERE student_id = ?').all(studentId);
  const courseIds = courses.map((c) => c.course_id);

  let questions = [];
  if (courseIds.length > 0) {
    const placeholders = courseIds.map(() => '?').join(',');
    questions = db
      .prepare(
        `SELECT dq.*, c.code as course_code
         FROM daily_questions dq JOIN courses c ON c.id = dq.course_id
         WHERE dq.course_id IN (${placeholders}) AND dq.scheduled_date <= date('now')
         ORDER BY dq.scheduled_date ASC, dq.position ASC, dq.id ASC`
      )
      .all(...courseIds);
  }

  if (questions.length === 0) {
    return res.render('student/daily', { title: 'Daily questions', question: null, questions: [] });
  }

  let index = parseInt(req.query.i, 10);
  if (Number.isNaN(index) || index < 0) index = questions.length - 1;
  if (index > questions.length - 1) index = questions.length - 1;
  const current = questions[index];

  let full;
  let selectedIds = new Set();
  const answer = db
    .prepare('SELECT * FROM daily_answers WHERE daily_question_id = ? AND student_id = ?')
    .get(current.id, studentId);

  if (current.type === 'mcq') {
    const options = db
      .prepare('SELECT id, option_text FROM daily_question_options WHERE daily_question_id = ? ORDER BY position ASC, id ASC')
      .all(current.id);
    full = { ...current, options };
    if (answer) {
      const selections = db
        .prepare('SELECT daily_question_option_id FROM daily_answer_selections WHERE daily_answer_id = ?')
        .all(answer.id);
      selectedIds = new Set(selections.map((s) => s.daily_question_option_id));
    }
  } else {
    const testCases = db
      .prepare('SELECT * FROM daily_question_test_cases WHERE daily_question_id = ? ORDER BY position ASC, id ASC')
      .all(current.id);
    full = { ...current, testCases };
  }

  res.render('student/daily', {
    title: 'Daily questions',
    question: full,
    answer,
    selectedIds,
    index,
    total: questions.length,
    hasPrev: index > 0,
    hasNext: index < questions.length - 1,
  });
});

router.post('/daily/:id/answer', (req, res) => {
  const studentId = req.session.user.id;
  const question = db.prepare('SELECT * FROM daily_questions WHERE id = ?').get(req.params.id);
  if (!question) return res.status(404).render('error', { title: 'Not found', message: 'Question not found.' });

  const enrolled = db
    .prepare('SELECT 1 FROM enrollments WHERE course_id = ? AND student_id = ?')
    .get(question.course_id, studentId);
  if (!enrolled) {
    return res.status(403).render('error', { title: 'Access denied', message: 'You are not enrolled in this course.' });
  }

  if (question.scheduled_date > new Date().toISOString().slice(0, 10)) {
    return res.status(403).render('error', { title: 'Not available yet', message: 'This question has not been released yet.' });
  }

  const tx = db.transaction(() => {
    if (question.type === 'mcq') {
      const options = db.prepare('SELECT id, is_correct FROM daily_question_options WHERE daily_question_id = ?').all(question.id);
      const correctIds = options.filter((o) => o.is_correct).map((o) => o.id);
      const selectedIds = [].concat(req.body.selected_option || []).map(Number).filter((n) => !Number.isNaN(n));
      const isCorrect = gradeMcq(selectedIds, correctIds) ? 1 : 0;
      const pointsAwarded = isCorrect ? question.points : 0;

      db.prepare(
        `INSERT INTO daily_answers (daily_question_id, student_id, is_correct, points_awarded)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(daily_question_id, student_id) DO UPDATE SET
           is_correct = excluded.is_correct, points_awarded = excluded.points_awarded, answered_at = datetime('now')`
      ).run(question.id, studentId, isCorrect, pointsAwarded);

      const answerId = db.prepare('SELECT id FROM daily_answers WHERE daily_question_id = ? AND student_id = ?').get(question.id, studentId).id;
      db.prepare('DELETE FROM daily_answer_selections WHERE daily_answer_id = ?').run(answerId);
      const insertSel = db.prepare('INSERT INTO daily_answer_selections (daily_answer_id, daily_question_option_id) VALUES (?, ?)');
      selectedIds.forEach((optId) => insertSel.run(answerId, optId));
    } else {
      const codeAnswer = req.body.code_answer !== undefined ? req.body.code_answer : '';
      db.prepare(
        `INSERT INTO daily_answers (daily_question_id, student_id, code_answer)
         VALUES (?, ?, ?)
         ON CONFLICT(daily_question_id, student_id) DO UPDATE SET
           code_answer = excluded.code_answer, answered_at = datetime('now')`
      ).run(question.id, studentId, codeAnswer);
    }
  });
  tx();

  logActivity(studentId, question.course_id, 'daily_answered', `Answered a daily question`);
  const i = req.body.index !== undefined ? '?i=' + encodeURIComponent(req.body.index) : '';
  res.redirect('/student/daily' + i);
});

// Profile: read-only summary of who the student is and what they're enrolled in
router.get('/profile', (req, res) => {
  const studentId = req.session.user.id;

  const me = db
    .prepare(
      `SELECT u.name, u.email, u.created_at, d.name as department_name, d.code as department_code
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id = ?`
    )
    .get(studentId);

  const courses = db
    .prepare(
      `SELECT c.code, c.title, u.name as faculty_name, e.enrolled_at
       FROM courses c JOIN enrollments e ON e.course_id = c.id
       LEFT JOIN users u ON u.id = c.faculty_id
       WHERE e.student_id = ? ORDER BY c.code`
    )
    .all(studentId);

  res.render('student/profile', { title: 'Profile', me, courses });
});

module.exports = router;
