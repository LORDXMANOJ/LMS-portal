const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { logActivity } = require('../db/activity');
const { extractYoutubeId } = require('../utils/youtube');
const { groupByWeek } = require('../utils/weeks');

const router = express.Router();
router.use(requireRole('faculty'));

const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const safe = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safe);
  },
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

router.get('/', (req, res) => {
  const facultyId = req.session.user.id;
  const courses = db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) as student_count,
        (SELECT COUNT(*) FROM assignments a WHERE a.course_id = c.id) as assignment_count
       FROM courses c WHERE c.faculty_id = ? ORDER BY c.code`
    )
    .all(facultyId);

  const courseIds = courses.map((c) => c.id);
  let recentSubmissions = [];
  let upcomingDue = [];
  if (courseIds.length > 0) {
    const placeholders = courseIds.map(() => '?').join(',');
    recentSubmissions = db
      .prepare(
        `SELECT s.*, u.name as student_name, a.title as assignment_title, c.code as course_code
         FROM submissions s
         JOIN assignments a ON a.id = s.assignment_id
         JOIN courses c ON c.id = a.course_id
         JOIN users u ON u.id = s.student_id
         WHERE a.course_id IN (${placeholders})
         ORDER BY s.submitted_at DESC LIMIT 10`
      )
      .all(...courseIds);

    upcomingDue = db
      .prepare(
        `SELECT a.*, c.code as course_code,
          (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) as submission_count,
          (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = a.course_id) as enrolled_count
         FROM assignments a JOIN courses c ON c.id = a.course_id
         WHERE a.course_id IN (${placeholders})
         ORDER BY a.due_date ASC LIMIT 5`
      )
      .all(...courseIds);
  }

  res.render('faculty/dashboard', { title: 'Dashboard', courses, recentSubmissions, upcomingDue });
});

// All submissions across all of this faculty member's courses
router.get('/submissions', (req, res) => {
  const facultyId = req.session.user.id;
  const courses = db.prepare('SELECT id FROM courses WHERE faculty_id = ?').all(facultyId);
  const courseIds = courses.map((c) => c.id);
  let submissions = [];
  if (courseIds.length > 0) {
    const placeholders = courseIds.map(() => '?').join(',');
    submissions = db
      .prepare(
        `SELECT s.*, u.name as student_name, a.title as assignment_title, a.max_points,
                c.code as course_code, c.id as course_id
         FROM submissions s
         JOIN assignments a ON a.id = s.assignment_id
         JOIN courses c ON c.id = a.course_id
         JOIN users u ON u.id = s.student_id
         WHERE a.course_id IN (${placeholders})
         ORDER BY s.submitted_at DESC`
      )
      .all(...courseIds);
  }
  res.render('faculty/submissions', { title: 'All submissions', submissions });
});

// Student accounts: any active faculty in the department can create, view,
// archive/restore, and reset the password of any student in that same
// department (not scoped to a single faculty member's own courses).
router.get('/students', (req, res) => {
  const departmentId = req.session.user.department_id;
  const students = db
    .prepare("SELECT * FROM users WHERE department_id = ? AND role = 'student' AND status = 'active' ORDER BY name")
    .all(departmentId);
  const archivedStudents = db
    .prepare("SELECT * FROM users WHERE department_id = ? AND role = 'student' AND status = 'archived' ORDER BY name")
    .all(departmentId);

  res.render('faculty/students', {
    title: 'Students',
    students,
    archivedStudents,
    resetPassword: req.query.newPassword || null,
    resetEmail: req.query.forEmail || null,
  });
});

router.get('/students/new', (req, res) => {
  res.render('faculty/student-new', { title: 'New student', error: null });
});

router.post('/students', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.render('faculty/student-new', { title: 'New student', error: 'All fields are required.' });
  }
  try {
    db.prepare(
      'INSERT INTO users (name, email, password_hash, role, department_id, created_by) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      name.trim(),
      email.trim().toLowerCase(),
      bcrypt.hashSync(password, 10),
      'student',
      req.session.user.department_id,
      req.session.user.id
    );
  } catch (e) {
    return res.render('faculty/student-new', { title: 'New student', error: 'That email is already registered.' });
  }
  res.redirect('/faculty/students');
});

function studentInMyDeptOr403(req, res, studentId) {
  const student = db.prepare('SELECT * FROM users WHERE id = ?').get(studentId);
  if (!student || student.role !== 'student' || student.department_id !== req.session.user.department_id) {
    res.status(403).render('error', { title: 'Access denied', message: 'You do not manage this student account.' });
    return null;
  }
  return student;
}

router.post('/students/:id/archive', (req, res) => {
  const student = studentInMyDeptOr403(req, res, req.params.id);
  if (!student) return;
  db.prepare("UPDATE users SET status = 'archived' WHERE id = ?").run(student.id);
  res.redirect('/faculty/students');
});

router.post('/students/:id/restore', (req, res) => {
  const student = studentInMyDeptOr403(req, res, req.params.id);
  if (!student) return;
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(student.id);
  res.redirect('/faculty/students');
});

router.post('/students/:id/reset-password', (req, res) => {
  const student = studentInMyDeptOr403(req, res, req.params.id);
  if (!student) return;
  const newPassword = Math.random().toString(36).slice(2, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), student.id);
  res.redirect(`/faculty/students?newPassword=${encodeURIComponent(newPassword)}&forEmail=${encodeURIComponent(student.email)}`);
});

function ownCourseOr403(req, res, courseId) {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
  if (!course || course.faculty_id !== req.session.user.id) {
    res.status(403).render('error', { title: 'Access denied', message: 'You do not manage this course.' });
    return null;
  }
  return course;
}

router.get('/courses/:id', (req, res) => {
  const course = ownCourseOr403(req, res, req.params.id);
  if (!course) return;

  const students = db
    .prepare(
      `SELECT u.id, u.name, u.email, e.enrolled_at
       FROM enrollments e JOIN users u ON u.id = e.student_id
       WHERE e.course_id = ? ORDER BY u.name`
    )
    .all(course.id);

  const materials = db.prepare('SELECT * FROM materials WHERE course_id = ? ORDER BY week_number ASC, created_at DESC').all(course.id);
  const assignments = db
    .prepare(
      `SELECT a.*,
        (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) as submission_count
       FROM assignments a WHERE a.course_id = ? ORDER BY a.week_number ASC, a.due_date ASC`
    )
    .all(course.id);
  const announcements = db.prepare('SELECT * FROM announcements WHERE course_id = ? ORDER BY created_at DESC').all(course.id);

  const allStudents = db
    .prepare("SELECT id, name, email FROM users WHERE role = 'student' AND status = 'active' AND department_id = ? ORDER BY name")
    .all(req.session.user.department_id);
  const enrolledIds = new Set(students.map((s) => s.id));
  const availableStudents = allStudents.filter((s) => !enrolledIds.has(s.id));

  res.render('faculty/course', {
    title: course.code,
    course,
    students,
    weeks: groupByWeek(materials, assignments),
    announcements,
    availableStudents,
    enrolled: req.query.enrolled || null,
    notFound: req.query.notFound || null,
    videoError: req.query.videoError || null,
  });
});

router.get('/courses/:id/edit', (req, res) => {
  const course = ownCourseOr403(req, res, req.params.id);
  if (!course) return;
  res.render('faculty/course-edit', { title: 'Edit ' + course.code, course, error: null });
});

router.post('/courses/:id/edit', (req, res) => {
  const course = ownCourseOr403(req, res, req.params.id);
  if (!course) return;
  const { title, description } = req.body;
  if (!title) {
    return res.render('faculty/course-edit', { title: 'Edit ' + course.code, course, error: 'Title is required.' });
  }
  db.prepare('UPDATE courses SET title = ?, description = ? WHERE id = ?').run(title.trim(), description || null, course.id);
  res.redirect('/faculty/courses/' + course.id);
});

router.post('/courses/:id/enroll', (req, res) => {
  const course = ownCourseOr403(req, res, req.params.id);
  if (!course) return;
  const { student_id } = req.body;
  try {
    db.prepare('INSERT INTO enrollments (course_id, student_id) VALUES (?, ?)').run(course.id, student_id);
    logActivity(student_id, course.id, 'enrolled', `Enrolled in ${course.code}`);
  } catch (e) {
    // already enrolled, ignore
  }
  res.redirect('/faculty/courses/' + course.id);
});

// Bulk enroll by pasting a list of student emails (one per line or comma separated)
router.post('/courses/:id/enroll-bulk', (req, res) => {
  const course = ownCourseOr403(req, res, req.params.id);
  if (!course) return;
  const { emails } = req.body;
  const list = (emails || '')
    .split(/[\n,]/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  let enrolled = 0;
  let notFound = [];
  const findUser = db.prepare(
    "SELECT id FROM users WHERE email = ? AND role = 'student' AND status = 'active' AND department_id = ?"
  );
  const insertEnroll = db.prepare('INSERT INTO enrollments (course_id, student_id) VALUES (?, ?)');

  list.forEach((email) => {
    const student = findUser.get(email, req.session.user.department_id);
    if (!student) {
      notFound.push(email);
      return;
    }
    try {
      insertEnroll.run(course.id, student.id);
      logActivity(student.id, course.id, 'enrolled', `Enrolled in ${course.code}`);
      enrolled++;
    } catch (e) {
      // already enrolled
    }
  });

  const query = notFound.length > 0 ? `?notFound=${encodeURIComponent(notFound.join(','))}&enrolled=${enrolled}` : `?enrolled=${enrolled}`;
  res.redirect('/faculty/courses/' + course.id + query);
});

router.post('/courses/:id/unenroll/:studentId', (req, res) => {
  const course = ownCourseOr403(req, res, req.params.id);
  if (!course) return;
  db.prepare('DELETE FROM enrollments WHERE course_id = ? AND student_id = ?').run(course.id, req.params.studentId);
  res.redirect('/faculty/courses/' + course.id);
});

router.post('/courses/:id/materials', upload.single('file'), (req, res) => {
  const course = ownCourseOr403(req, res, req.params.id);
  if (!course) return;
  const { title, type, content, week_number } = req.body;
  if (!title || !type) return res.redirect('/faculty/courses/' + course.id);

  if (type === 'video' && !extractYoutubeId(content || '')) {
    return res.redirect('/faculty/courses/' + course.id + '?videoError=1');
  }

  const filePath = req.file ? '/uploads/' + req.file.filename : null;
  db.prepare(
    'INSERT INTO materials (course_id, title, type, content, file_path, week_number, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(course.id, title, type, content || null, filePath, parseInt(week_number, 10) || 0, req.session.user.id);
  res.redirect('/faculty/courses/' + course.id);
});

router.post('/materials/:id/delete', (req, res) => {
  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  if (!material) return res.redirect('/faculty');
  const course = ownCourseOr403(req, res, material.course_id);
  if (!course) return;
  db.prepare('DELETE FROM materials WHERE id = ?').run(material.id);
  res.redirect('/faculty/courses/' + course.id);
});

router.post('/courses/:id/assignments', (req, res) => {
  const course = ownCourseOr403(req, res, req.params.id);
  if (!course) return;
  const { title, description, due_date, max_points, week_number } = req.body;
  if (!title || !due_date) return res.redirect('/faculty/courses/' + course.id);
  db.prepare(
    'INSERT INTO assignments (course_id, title, description, due_date, max_points, week_number, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(course.id, title, description || null, due_date, max_points || 100, parseInt(week_number, 10) || 0, req.session.user.id);
  res.redirect('/faculty/courses/' + course.id);
});

router.get('/assignments/:id/edit', (req, res) => {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (!assignment) return res.status(404).render('error', { title: 'Not found', message: 'Assignment not found.' });
  const course = ownCourseOr403(req, res, assignment.course_id);
  if (!course) return;
  res.render('faculty/assignment-edit', { title: 'Edit assignment', assignment, course, error: null });
});

router.post('/assignments/:id/edit', (req, res) => {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (!assignment) return res.status(404).render('error', { title: 'Not found', message: 'Assignment not found.' });
  const course = ownCourseOr403(req, res, assignment.course_id);
  if (!course) return;

  const { title, description, due_date, max_points, week_number } = req.body;
  if (!title || !due_date) {
    return res.render('faculty/assignment-edit', { title: 'Edit assignment', assignment, course, error: 'Title and due date are required.' });
  }
  db.prepare(
    'UPDATE assignments SET title = ?, description = ?, due_date = ?, max_points = ?, week_number = ? WHERE id = ?'
  ).run(title.trim(), description || null, due_date, max_points || 100, parseInt(week_number, 10) || 0, assignment.id);
  res.redirect('/faculty/assignments/' + assignment.id);
});

router.post('/assignments/:id/delete', (req, res) => {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (!assignment) return res.redirect('/faculty');
  const course = ownCourseOr403(req, res, assignment.course_id);
  if (!course) return;
  db.prepare('DELETE FROM assignments WHERE id = ?').run(assignment.id);
  res.redirect('/faculty/courses/' + course.id);
});

router.post('/courses/:id/announcements', (req, res) => {
  const course = ownCourseOr403(req, res, req.params.id);
  if (!course) return;
  const { title, body } = req.body;
  if (!title || !body) return res.redirect('/faculty/courses/' + course.id);
  db.prepare(
    'INSERT INTO announcements (course_id, title, body, posted_by) VALUES (?, ?, ?, ?)'
  ).run(course.id, title, body, req.session.user.id);
  res.redirect('/faculty/courses/' + course.id);
});

// Attach options (mcq) or test cases (program) to a list of questions from
// either the assignment-question tables or the daily-question tables.
function attachQuestionDetails(questions, { optionsTable, optionsFk, testCasesTable, testCasesFk }) {
  return questions.map((q) => {
    if (q.type === 'mcq') {
      const options = db
        .prepare(`SELECT * FROM ${optionsTable} WHERE ${optionsFk} = ? ORDER BY position ASC, id ASC`)
        .all(q.id);
      return { ...q, options };
    }
    const testCases = db
      .prepare(`SELECT * FROM ${testCasesTable} WHERE ${testCasesFk} = ? ORDER BY position ASC, id ASC`)
      .all(q.id);
    return { ...q, testCases };
  });
}

const QUESTION_CHILD_TABLES = {
  optionsTable: 'question_options',
  optionsFk: 'question_id',
  testCasesTable: 'question_test_cases',
  testCasesFk: 'question_id',
};

function parseOptionRows(body) {
  // option_text[] and option_correct[] arrive as parallel arrays (or single
  // values if there's only one row) from the dynamic option-row form.
  const texts = [].concat(body.option_text || []);
  const correctFlags = new Set([].concat(body.option_correct || []));
  return texts
    .map((text, i) => ({ text: (text || '').trim(), correct: correctFlags.has(String(i)) }))
    .filter((o) => o.text.length > 0);
}

function parseTestCaseRows(body) {
  const inputs = [].concat(body.test_input || []);
  const outputs = [].concat(body.test_output || []);
  return inputs
    .map((input, i) => ({ input: (input || '').trim(), output: (outputs[i] || '').trim() }))
    .filter((tc) => tc.input.length > 0 || tc.output.length > 0);
}

router.get('/assignments/:id', (req, res) => {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (!assignment) return res.status(404).render('error', { title: 'Not found', message: 'Assignment not found.' });
  const course = ownCourseOr403(req, res, assignment.course_id);
  if (!course) return;

  const submissions = db
    .prepare(
      `SELECT s.*, u.name as student_name, u.email as student_email
       FROM submissions s JOIN users u ON u.id = s.student_id
       WHERE s.assignment_id = ? ORDER BY s.submitted_at DESC`
    )
    .all(assignment.id);

  const enrolledStudents = db
    .prepare(
      `SELECT u.id, u.name FROM enrollments e JOIN users u ON u.id = e.student_id WHERE e.course_id = ?`
    )
    .all(course.id);
  const submittedIds = new Set(submissions.map((s) => s.student_id));
  const notSubmitted = enrolledStudents.filter((s) => !submittedIds.has(s.id));

  const questions = attachQuestionDetails(
    db.prepare('SELECT * FROM questions WHERE assignment_id = ? ORDER BY position ASC, id ASC').all(assignment.id),
    QUESTION_CHILD_TABLES
  );
  const mcqQuestions = questions.filter((q) => q.type === 'mcq');
  const programQuestions = questions.filter((q) => q.type === 'program');

  res.render('faculty/assignment', {
    title: assignment.title,
    assignment,
    course,
    submissions,
    notSubmitted,
    mcqQuestions,
    programQuestions,
  });
});

router.get('/assignments/:id/questions/mcq/new', (req, res) => {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (!assignment) return res.status(404).render('error', { title: 'Not found', message: 'Assignment not found.' });
  const course = ownCourseOr403(req, res, assignment.course_id);
  if (!course) return;
  res.render('faculty/question-form', {
    title: 'New multiple choice question',
    mode: 'create',
    kind: 'mcq',
    backTo: '/faculty/assignments/' + assignment.id,
    action: '/faculty/assignments/' + assignment.id + '/questions/mcq',
    question: null,
    error: null,
  });
});

router.post('/assignments/:id/questions/mcq', (req, res) => {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (!assignment) return res.status(404).render('error', { title: 'Not found', message: 'Assignment not found.' });
  const course = ownCourseOr403(req, res, assignment.course_id);
  if (!course) return;

  const { question_text, points } = req.body;
  const options = parseOptionRows(req.body);
  const backTo = '/faculty/assignments/' + assignment.id;

  if (!question_text || options.length < 2 || !options.some((o) => o.correct)) {
    return res.render('faculty/question-form', {
      title: 'New multiple choice question',
      mode: 'create',
      kind: 'mcq',
      backTo,
      action: backTo + '/questions/mcq',
      question: null,
      error: 'Add at least two options and mark at least one as correct.',
    });
  }

  const tx = db.transaction(() => {
    const nextPosition = db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 as pos FROM questions WHERE assignment_id = ?')
      .get(assignment.id).pos;
    const result = db
      .prepare(`INSERT INTO questions (assignment_id, type, position, question_text, points) VALUES (?, 'mcq', ?, ?, ?)`)
      .run(assignment.id, nextPosition, question_text.trim(), points || 10);
    const insertOption = db.prepare(
      'INSERT INTO question_options (question_id, option_text, is_correct, position) VALUES (?, ?, ?, ?)'
    );
    options.forEach((o, i) => insertOption.run(result.lastInsertRowid, o.text, o.correct ? 1 : 0, i));
  });
  tx();

  res.redirect(backTo);
});

router.get('/assignments/:id/questions/program/new', (req, res) => {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (!assignment) return res.status(404).render('error', { title: 'Not found', message: 'Assignment not found.' });
  const course = ownCourseOr403(req, res, assignment.course_id);
  if (!course) return;
  res.render('faculty/question-form', {
    title: 'New programming question',
    mode: 'create',
    kind: 'program',
    backTo: '/faculty/assignments/' + assignment.id,
    action: '/faculty/assignments/' + assignment.id + '/questions/program',
    question: null,
    error: null,
  });
});

router.post('/assignments/:id/questions/program', (req, res) => {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (!assignment) return res.status(404).render('error', { title: 'Not found', message: 'Assignment not found.' });
  const course = ownCourseOr403(req, res, assignment.course_id);
  if (!course) return;

  const { question_text, language, starter_code, points } = req.body;
  const backTo = '/faculty/assignments/' + assignment.id;
  if (!question_text) {
    return res.render('faculty/question-form', {
      title: 'New programming question',
      mode: 'create',
      kind: 'program',
      backTo,
      action: backTo + '/questions/program',
      question: null,
      error: 'Question text is required.',
    });
  }

  const testCases = parseTestCaseRows(req.body);

  const tx = db.transaction(() => {
    const nextPosition = db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 as pos FROM questions WHERE assignment_id = ?')
      .get(assignment.id).pos;
    const result = db
      .prepare(
        `INSERT INTO questions (assignment_id, type, position, question_text, points, language, starter_code)
         VALUES (?, 'program', ?, ?, ?, ?, ?)`
      )
      .run(assignment.id, nextPosition, question_text.trim(), points || 10, language || 'javascript', starter_code || '');
    const insertCase = db.prepare(
      'INSERT INTO question_test_cases (question_id, input, expected_output, position) VALUES (?, ?, ?, ?)'
    );
    testCases.forEach((tc, i) => insertCase.run(result.lastInsertRowid, tc.input, tc.output, i));
  });
  tx();

  res.redirect(backTo);
});

router.get('/questions/:id/edit', (req, res) => {
  const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
  if (!question) return res.status(404).render('error', { title: 'Not found', message: 'Question not found.' });
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(question.assignment_id);
  const course = ownCourseOr403(req, res, assignment.course_id);
  if (!course) return;

  const [full] = attachQuestionDetails([question], QUESTION_CHILD_TABLES);
  const backTo = '/faculty/assignments/' + assignment.id;

  res.render('faculty/question-form', {
    title: 'Edit question',
    mode: 'edit',
    kind: question.type,
    backTo,
    action: '/faculty/questions/' + question.id + '/edit',
    question: full,
    error: null,
  });
});

router.post('/questions/:id/edit', (req, res) => {
  const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
  if (!question) return res.status(404).render('error', { title: 'Not found', message: 'Question not found.' });
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(question.assignment_id);
  const course = ownCourseOr403(req, res, assignment.course_id);
  if (!course) return;

  const backTo = '/faculty/assignments/' + assignment.id;
  const { question_text, points } = req.body;

  if (!question_text) {
    const [full] = attachQuestionDetails([question], QUESTION_CHILD_TABLES);
    return res.render('faculty/question-form', {
      title: 'Edit question',
      mode: 'edit',
      kind: question.type,
      backTo,
      action: '/faculty/questions/' + question.id + '/edit',
      question: full,
      error: 'Question text is required.',
    });
  }

  if (question.type === 'mcq') {
    const options = parseOptionRows(req.body);
    if (options.length < 2 || !options.some((o) => o.correct)) {
      const [full] = attachQuestionDetails([question], QUESTION_CHILD_TABLES);
      return res.render('faculty/question-form', {
        title: 'Edit question',
        mode: 'edit',
        kind: 'mcq',
        backTo,
        action: '/faculty/questions/' + question.id + '/edit',
        question: full,
        error: 'Add at least two options and mark at least one as correct.',
      });
    }
    const tx = db.transaction(() => {
      db.prepare(`UPDATE questions SET question_text = ?, points = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(question_text.trim(), points || 10, question.id);
      db.prepare('DELETE FROM question_options WHERE question_id = ?').run(question.id);
      const insertOption = db.prepare(
        'INSERT INTO question_options (question_id, option_text, is_correct, position) VALUES (?, ?, ?, ?)'
      );
      options.forEach((o, i) => insertOption.run(question.id, o.text, o.correct ? 1 : 0, i));
    });
    tx();
  } else {
    const { language, starter_code } = req.body;
    const testCases = parseTestCaseRows(req.body);
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE questions SET question_text = ?, points = ?, language = ?, starter_code = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(question_text.trim(), points || 10, language || 'javascript', starter_code || '', question.id);
      db.prepare('DELETE FROM question_test_cases WHERE question_id = ?').run(question.id);
      const insertCase = db.prepare(
        'INSERT INTO question_test_cases (question_id, input, expected_output, position) VALUES (?, ?, ?, ?)'
      );
      testCases.forEach((tc, i) => insertCase.run(question.id, tc.input, tc.output, i));
    });
    tx();
  }

  res.redirect(backTo);
});

router.post('/questions/:id/delete', (req, res) => {
  const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
  if (!question) return res.redirect('/faculty');
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(question.assignment_id);
  const course = ownCourseOr403(req, res, assignment.course_id);
  if (!course) return;
  db.prepare('DELETE FROM questions WHERE id = ?').run(question.id);
  res.redirect('/faculty/assignments/' + assignment.id);
});

// View a single student's answers for a question-based assignment
router.get('/submissions/:id/answers', (req, res) => {
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!submission) return res.status(404).render('error', { title: 'Not found', message: 'Submission not found.' });
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(submission.assignment_id);
  const course = ownCourseOr403(req, res, assignment.course_id);
  if (!course) return;

  const student = db.prepare('SELECT * FROM users WHERE id = ?').get(submission.student_id);
  const questions = attachQuestionDetails(
    db.prepare('SELECT * FROM questions WHERE assignment_id = ? ORDER BY position ASC, id ASC').all(assignment.id),
    QUESTION_CHILD_TABLES
  );
  const answers = db.prepare('SELECT * FROM answers WHERE submission_id = ?').all(submission.id);
  const selections = db
    .prepare(
      `SELECT ans.question_id, sel.question_option_id FROM answer_selections sel
       JOIN answers ans ON ans.id = sel.answer_id WHERE ans.submission_id = ?`
    )
    .all(submission.id);
  const selectedByQuestion = {};
  selections.forEach((s) => {
    if (!selectedByQuestion[s.question_id]) selectedByQuestion[s.question_id] = new Set();
    selectedByQuestion[s.question_id].add(s.question_option_id);
  });
  const answersByQuestion = {};
  answers.forEach((a) => { answersByQuestion[a.question_id] = a; });

  res.render('faculty/submission-answers', {
    title: 'Answers: ' + student.name,
    assignment,
    course,
    submission,
    student,
    mcqQuestions: questions.filter((q) => q.type === 'mcq'),
    programQuestions: questions.filter((q) => q.type === 'program'),
    answersByQuestion,
    selectedByQuestion,
  });
});

router.post('/submissions/:id/grade', (req, res) => {
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!submission) return res.redirect('/faculty');
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(submission.assignment_id);
  const course = ownCourseOr403(req, res, assignment.course_id);
  if (!course) return;

  const { grade, feedback } = req.body;
  db.prepare("UPDATE submissions SET grade = ?, feedback = ?, status = 'graded' WHERE id = ?").run(
    grade || null,
    feedback || null,
    submission.id
  );
  logActivity(submission.student_id, course.id, 'graded', `Received a grade for ${assignment.title}`);
  res.redirect('/faculty/assignments/' + assignment.id);
});

router.get('/reports/:id', (req, res) => {
  const course = ownCourseOr403(req, res, req.params.id);
  if (!course) return;

  const totalStudents = db.prepare('SELECT COUNT(*) as c FROM enrollments WHERE course_id = ?').get(course.id).c;
  const totalAssignments = db.prepare('SELECT COUNT(*) as c FROM assignments WHERE course_id = ?').get(course.id).c;

  const perAssignment = db
    .prepare(
      `SELECT a.id, a.title, a.due_date,
        (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) as submitted_count,
        (SELECT AVG(grade) FROM submissions s WHERE s.assignment_id = a.id AND s.grade IS NOT NULL) as avg_grade
       FROM assignments a WHERE a.course_id = ? ORDER BY a.due_date`
    )
    .all(course.id);

  const perStudent = db
    .prepare(
      `SELECT u.id, u.name,
        (SELECT COUNT(*) FROM submissions s JOIN assignments a ON a.id = s.assignment_id
         WHERE a.course_id = ? AND s.student_id = u.id) as completed
       FROM enrollments e JOIN users u ON u.id = e.student_id
       WHERE e.course_id = ? ORDER BY u.name`
    )
    .all(course.id, course.id);

  res.render('faculty/report', {
    title: 'Report: ' + course.code,
    course,
    totalStudents,
    totalAssignments,
    perAssignment,
    perStudent,
  });
});

router.get('/reports/:id/export.csv', (req, res) => {
  const course = ownCourseOr403(req, res, req.params.id);
  if (!course) return;

  const totalAssignments = db.prepare('SELECT COUNT(*) as c FROM assignments WHERE course_id = ?').get(course.id).c;
  const perStudent = db
    .prepare(
      `SELECT u.name, u.email,
        (SELECT COUNT(*) FROM submissions s JOIN assignments a ON a.id = s.assignment_id
         WHERE a.course_id = ? AND s.student_id = u.id) as completed,
        (SELECT AVG(grade) FROM submissions s JOIN assignments a ON a.id = s.assignment_id
         WHERE a.course_id = ? AND s.student_id = u.id AND s.grade IS NOT NULL) as avg_grade
       FROM enrollments e JOIN users u ON u.id = e.student_id
       WHERE e.course_id = ? ORDER BY u.name`
    )
    .all(course.id, course.id, course.id);

  const csvEscape = (val) => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const rows = [
    ['Student', 'Email', 'Assignments completed', 'Total assignments', 'Average grade'],
    ...perStudent.map((s) => [
      s.name,
      s.email,
      s.completed,
      totalAssignments,
      s.avg_grade !== null && s.avg_grade !== undefined ? Math.round(s.avg_grade * 10) / 10 : '',
    ]),
  ];
  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${course.code}-report.csv"`);
  res.send(csv);
});

// Daily questions are a separate practice-question queue per course. Unlike
// assignments (owner-only), any active faculty in the same department as the
// course's owner can queue, edit, or remove daily questions for it.
function courseInMyDeptOr403(req, res, courseId) {
  const course = db
    .prepare(
      `SELECT c.* FROM courses c JOIN users u ON u.id = c.faculty_id
       WHERE c.id = ? AND u.department_id = ?`
    )
    .get(courseId, req.session.user.department_id);
  if (!course) {
    res.status(403).render('error', { title: 'Access denied', message: 'This course is not in your department.' });
    return null;
  }
  return course;
}

const DAILY_QUESTION_CHILD_TABLES = {
  optionsTable: 'daily_question_options',
  optionsFk: 'daily_question_id',
  testCasesTable: 'daily_question_test_cases',
  testCasesFk: 'daily_question_id',
};

router.get('/courses/:id/daily', (req, res) => {
  const course = courseInMyDeptOr403(req, res, req.params.id);
  if (!course) return;

  const questions = attachQuestionDetails(
    db.prepare('SELECT * FROM daily_questions WHERE course_id = ? ORDER BY scheduled_date ASC, position ASC, id ASC').all(course.id),
    DAILY_QUESTION_CHILD_TABLES
  );

  // Something faculty can act on in class: who hasn't answered today's
  // released question(s) yet, so a quick "half of you haven't done today's
  // question" callout is possible without digging through submissions.
  const todaysQuestions = questions.filter((q) => q.scheduled_date === new Date().toISOString().slice(0, 10));
  let notAnsweredToday = [];
  if (todaysQuestions.length > 0) {
    const enrolledStudents = db
      .prepare(`SELECT u.id, u.name FROM enrollments e JOIN users u ON u.id = e.student_id WHERE e.course_id = ? ORDER BY u.name`)
      .all(course.id);
    const todaysIds = todaysQuestions.map((q) => q.id);
    const placeholders = todaysIds.map(() => '?').join(',');
    const answeredIds = new Set(
      db
        .prepare(`SELECT DISTINCT student_id FROM daily_answers WHERE daily_question_id IN (${placeholders})`)
        .all(...todaysIds)
        .map((r) => r.student_id)
    );
    notAnsweredToday = enrolledStudents.filter((s) => !answeredIds.has(s.id));
  }

  res.render('faculty/daily-queue', { title: 'Daily questions: ' + course.code, course, questions, notAnsweredToday });
});

router.get('/courses/:id/daily/mcq/new', (req, res) => {
  const course = courseInMyDeptOr403(req, res, req.params.id);
  if (!course) return;
  res.render('faculty/question-form', {
    title: 'New daily multiple choice question',
    mode: 'create',
    kind: 'mcq',
    daily: true,
    backTo: '/faculty/courses/' + course.id + '/daily',
    action: '/faculty/courses/' + course.id + '/daily/mcq',
    question: null,
    error: null,
  });
});

router.post('/courses/:id/daily/mcq', (req, res) => {
  const course = courseInMyDeptOr403(req, res, req.params.id);
  if (!course) return;

  const { question_text, points, scheduled_date } = req.body;
  const options = parseOptionRows(req.body);
  const backTo = '/faculty/courses/' + course.id + '/daily';

  if (!question_text || !scheduled_date || options.length < 2 || !options.some((o) => o.correct)) {
    return res.render('faculty/question-form', {
      title: 'New daily multiple choice question',
      mode: 'create',
      kind: 'mcq',
      daily: true,
      backTo,
      action: backTo + '/mcq',
      question: null,
      error: 'A release date, at least two options, and at least one correct option are required.',
    });
  }

  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO daily_questions (course_id, type, question_text, points, scheduled_date, created_by)
         VALUES (?, 'mcq', ?, ?, ?, ?)`
      )
      .run(course.id, question_text.trim(), points || 10, scheduled_date, req.session.user.id);
    const insertOption = db.prepare(
      'INSERT INTO daily_question_options (daily_question_id, option_text, is_correct, position) VALUES (?, ?, ?, ?)'
    );
    options.forEach((o, i) => insertOption.run(result.lastInsertRowid, o.text, o.correct ? 1 : 0, i));
  });
  tx();

  res.redirect(backTo);
});

router.get('/courses/:id/daily/program/new', (req, res) => {
  const course = courseInMyDeptOr403(req, res, req.params.id);
  if (!course) return;
  res.render('faculty/question-form', {
    title: 'New daily programming question',
    mode: 'create',
    kind: 'program',
    daily: true,
    backTo: '/faculty/courses/' + course.id + '/daily',
    action: '/faculty/courses/' + course.id + '/daily/program',
    question: null,
    error: null,
  });
});

router.post('/courses/:id/daily/program', (req, res) => {
  const course = courseInMyDeptOr403(req, res, req.params.id);
  if (!course) return;

  const { question_text, language, starter_code, points, scheduled_date } = req.body;
  const backTo = '/faculty/courses/' + course.id + '/daily';
  if (!question_text || !scheduled_date) {
    return res.render('faculty/question-form', {
      title: 'New daily programming question',
      mode: 'create',
      kind: 'program',
      daily: true,
      backTo,
      action: backTo + '/program',
      question: null,
      error: 'Question text and a release date are required.',
    });
  }

  const testCases = parseTestCaseRows(req.body);

  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO daily_questions (course_id, type, question_text, points, language, starter_code, scheduled_date, created_by)
         VALUES (?, 'program', ?, ?, ?, ?, ?, ?)`
      )
      .run(course.id, question_text.trim(), points || 10, language || 'javascript', starter_code || '', scheduled_date, req.session.user.id);
    const insertCase = db.prepare(
      'INSERT INTO daily_question_test_cases (daily_question_id, input, expected_output, position) VALUES (?, ?, ?, ?)'
    );
    testCases.forEach((tc, i) => insertCase.run(result.lastInsertRowid, tc.input, tc.output, i));
  });
  tx();

  res.redirect(backTo);
});

router.get('/daily/:id/edit', (req, res) => {
  const question = db.prepare('SELECT * FROM daily_questions WHERE id = ?').get(req.params.id);
  if (!question) return res.status(404).render('error', { title: 'Not found', message: 'Question not found.' });
  const course = courseInMyDeptOr403(req, res, question.course_id);
  if (!course) return;

  const [full] = attachQuestionDetails([question], DAILY_QUESTION_CHILD_TABLES);
  const backTo = '/faculty/courses/' + course.id + '/daily';

  res.render('faculty/question-form', {
    title: 'Edit daily question',
    mode: 'edit',
    kind: question.type,
    daily: true,
    backTo,
    action: '/faculty/daily/' + question.id + '/edit',
    question: full,
    error: null,
  });
});

router.post('/daily/:id/edit', (req, res) => {
  const question = db.prepare('SELECT * FROM daily_questions WHERE id = ?').get(req.params.id);
  if (!question) return res.status(404).render('error', { title: 'Not found', message: 'Question not found.' });
  const course = courseInMyDeptOr403(req, res, question.course_id);
  if (!course) return;

  const backTo = '/faculty/courses/' + course.id + '/daily';
  const { question_text, scheduled_date, points } = req.body;

  if (!question_text || !scheduled_date) {
    const [full] = attachQuestionDetails([question], DAILY_QUESTION_CHILD_TABLES);
    return res.render('faculty/question-form', {
      title: 'Edit daily question',
      mode: 'edit',
      kind: question.type,
      daily: true,
      backTo,
      action: '/faculty/daily/' + question.id + '/edit',
      question: full,
      error: 'Question text and a release date are required.',
    });
  }

  if (question.type === 'mcq') {
    const options = parseOptionRows(req.body);
    if (options.length < 2 || !options.some((o) => o.correct)) {
      const [full] = attachQuestionDetails([question], DAILY_QUESTION_CHILD_TABLES);
      return res.render('faculty/question-form', {
        title: 'Edit daily question',
        mode: 'edit',
        kind: 'mcq',
        daily: true,
        backTo,
        action: '/faculty/daily/' + question.id + '/edit',
        question: full,
        error: 'Add at least two options and mark at least one as correct.',
      });
    }
    const tx = db.transaction(() => {
      db.prepare(`UPDATE daily_questions SET question_text = ?, points = ?, scheduled_date = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(question_text.trim(), points || 10, scheduled_date, question.id);
      db.prepare('DELETE FROM daily_question_options WHERE daily_question_id = ?').run(question.id);
      const insertOption = db.prepare(
        'INSERT INTO daily_question_options (daily_question_id, option_text, is_correct, position) VALUES (?, ?, ?, ?)'
      );
      options.forEach((o, i) => insertOption.run(question.id, o.text, o.correct ? 1 : 0, i));
    });
    tx();
  } else {
    const { language, starter_code } = req.body;
    const testCases = parseTestCaseRows(req.body);
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE daily_questions SET question_text = ?, points = ?, scheduled_date = ?, language = ?, starter_code = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(question_text.trim(), points || 10, scheduled_date, language || 'javascript', starter_code || '', question.id);
      db.prepare('DELETE FROM daily_question_test_cases WHERE daily_question_id = ?').run(question.id);
      const insertCase = db.prepare(
        'INSERT INTO daily_question_test_cases (daily_question_id, input, expected_output, position) VALUES (?, ?, ?, ?)'
      );
      testCases.forEach((tc, i) => insertCase.run(question.id, tc.input, tc.output, i));
    });
    tx();
  }

  res.redirect(backTo);
});

router.post('/daily/:id/delete', (req, res) => {
  const question = db.prepare('SELECT * FROM daily_questions WHERE id = ?').get(req.params.id);
  if (!question) return res.redirect('/faculty');
  const course = courseInMyDeptOr403(req, res, question.course_id);
  if (!course) return;
  db.prepare('DELETE FROM daily_questions WHERE id = ?').run(question.id);
  res.redirect('/faculty/courses/' + course.id + '/daily');
});

// View a student's answers to daily questions for a course
router.get('/courses/:id/daily/answers/:studentId', (req, res) => {
  const course = courseInMyDeptOr403(req, res, req.params.id);
  if (!course) return;
  const student = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.studentId);
  if (!student) return res.status(404).render('error', { title: 'Not found', message: 'Student not found.' });

  const questions = attachQuestionDetails(
    db.prepare('SELECT * FROM daily_questions WHERE course_id = ? ORDER BY scheduled_date DESC, position ASC').all(course.id),
    DAILY_QUESTION_CHILD_TABLES
  );
  const answers = db
    .prepare(
      `SELECT da.* FROM daily_answers da JOIN daily_questions dq ON dq.id = da.daily_question_id
       WHERE dq.course_id = ? AND da.student_id = ?`
    )
    .all(course.id, student.id);
  const selections = db
    .prepare(
      `SELECT da.daily_question_id, sel.daily_question_option_id FROM daily_answer_selections sel
       JOIN daily_answers da ON da.id = sel.daily_answer_id
       JOIN daily_questions dq ON dq.id = da.daily_question_id
       WHERE dq.course_id = ? AND da.student_id = ?`
    )
    .all(course.id, student.id);
  const selectedByQuestion = {};
  selections.forEach((s) => {
    if (!selectedByQuestion[s.daily_question_id]) selectedByQuestion[s.daily_question_id] = new Set();
    selectedByQuestion[s.daily_question_id].add(s.daily_question_option_id);
  });
  const answersByQuestion = {};
  answers.forEach((a) => { answersByQuestion[a.daily_question_id] = a; });

  res.render('faculty/daily-answers', { title: 'Daily answers: ' + student.name, course, student, questions, answersByQuestion, selectedByQuestion });
});

module.exports = router;
