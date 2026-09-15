const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { archiveDepartment, restoreDepartment } = require('../db/hierarchy');

const router = express.Router();
router.use(requireRole('admin'));

router.get('/', (req, res) => {
  const stats = {
    departments: db.prepare("SELECT COUNT(*) as c FROM departments WHERE status = 'active'").get().c,
    students: db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'student' AND status = 'active'").get().c,
    faculty: db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'faculty' AND status = 'active'").get().c,
    submissions: db.prepare('SELECT COUNT(*) as c FROM submissions').get().c,
  };

  const departments = db
    .prepare(
      `SELECT d.*, h.name as hod_name, h.email as hod_email,
        (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.role = 'faculty' AND u.status = 'active') as faculty_count,
        (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.role = 'student' AND u.status = 'active') as student_count
       FROM departments d LEFT JOIN users h ON h.id = d.hod_id
       WHERE d.status = 'active'
       ORDER BY d.code`
    )
    .all();

  const archivedDepartments = db
    .prepare(
      `SELECT d.*, h.name as hod_name, h.email as hod_email
       FROM departments d LEFT JOIN users h ON h.id = d.hod_id
       WHERE d.status = 'archived'
       ORDER BY d.code`
    )
    .all();

  const admins = db.prepare("SELECT id, name, email, created_at FROM users WHERE role = 'admin' ORDER BY name").all();

  res.render('admin/dashboard', {
    title: 'Admin',
    stats,
    departments,
    archivedDepartments,
    admins,
    resetPassword: req.query.newPassword || null,
    resetEmail: req.query.forEmail || null,
  });
});

// Create a department and its head (HOD) together in one step.
// Must be registered before the '/departments/:id' route below, or Express
// would match this path as departments/:id with id="new" first.
router.get('/departments/new', (req, res) => {
  res.render('admin/department-new', { title: 'New department', error: null });
});

// Department detail: its courses and an aggregate (not per-student) view of
// how students in the department are doing overall.
router.get('/departments/:id', (req, res) => {
  const department = db
    .prepare(
      `SELECT d.*, h.name as hod_name, h.email as hod_email
       FROM departments d LEFT JOIN users h ON h.id = d.hod_id WHERE d.id = ?`
    )
    .get(req.params.id);
  if (!department) return res.status(404).render('error', { title: 'Not found', message: 'Department not found.' });

  const facultyCount = db
    .prepare("SELECT COUNT(*) as c FROM users WHERE department_id = ? AND role = 'faculty' AND status = 'active'")
    .get(department.id).c;
  const studentCount = db
    .prepare("SELECT COUNT(*) as c FROM users WHERE department_id = ? AND role = 'student' AND status = 'active'")
    .get(department.id).c;

  const courses = db
    .prepare(
      `SELECT c.*, u.name as faculty_name,
        (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) as student_count,
        (SELECT COUNT(*) FROM assignments a WHERE a.course_id = c.id) as assignment_count
       FROM courses c JOIN users u ON u.id = c.faculty_id
       WHERE u.department_id = ?
       ORDER BY c.code`
    )
    .all(department.id);

  // Overall performance: one aggregate completion rate and one aggregate
  // average grade across every course in the department, not broken out per
  // student or per course.
  const courseIds = courses.map((c) => c.id);
  let completionPercent = 0;
  let avgGrade = null;
  let totalSubmissions = 0;

  if (courseIds.length > 0) {
    const placeholders = courseIds.map(() => '?').join(',');
    const possible = db
      .prepare(
        `SELECT COALESCE(SUM(enrolled * assignment_count), 0) as total FROM (
           SELECT c.id,
             (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) as enrolled,
             (SELECT COUNT(*) FROM assignments a WHERE a.course_id = c.id) as assignment_count
           FROM courses c WHERE c.id IN (${placeholders})
         )`
      )
      .get(...courseIds).total;

    const actual = db
      .prepare(
        `SELECT COUNT(*) as c FROM submissions s
         JOIN assignments a ON a.id = s.assignment_id
         WHERE a.course_id IN (${placeholders})`
      )
      .get(...courseIds).c;

    totalSubmissions = actual;
    completionPercent = possible > 0 ? Math.round((actual / possible) * 100) : 0;

    const avgRow = db
      .prepare(
        `SELECT AVG(s.grade) as avg FROM submissions s
         JOIN assignments a ON a.id = s.assignment_id
         WHERE a.course_id IN (${placeholders}) AND s.grade IS NOT NULL`
      )
      .get(...courseIds);
    avgGrade = avgRow.avg !== null && avgRow.avg !== undefined ? Math.round(avgRow.avg * 10) / 10 : null;
  }

  const facultyList = db
    .prepare("SELECT id, name FROM users WHERE role = 'faculty' AND status = 'active' AND department_id = ? ORDER BY name")
    .all(department.id);

  res.render('admin/department-detail', {
    title: department.code,
    department,
    facultyCount,
    studentCount,
    courses,
    completionPercent,
    avgGrade,
    totalSubmissions,
    facultyList,
  });
});

router.post('/departments', (req, res) => {
  const { name, code, hod_name, hod_email, hod_password } = req.body;
  if (!name || !code || !hod_name || !hod_email || !hod_password) {
    return res.render('admin/department-new', { title: 'New department', error: 'All fields are required.' });
  }

  const tx = db.transaction(() => {
    const deptResult = db
      .prepare('INSERT INTO departments (name, code) VALUES (?, ?)')
      .run(name.trim(), code.trim().toUpperCase());
    const deptId = deptResult.lastInsertRowid;

    const hodResult = db
      .prepare('INSERT INTO users (name, email, password_hash, role, department_id, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(hod_name.trim(), hod_email.trim().toLowerCase(), bcrypt.hashSync(hod_password, 10), 'hod', deptId, req.session.user.id);

    db.prepare('UPDATE departments SET hod_id = ? WHERE id = ?').run(hodResult.lastInsertRowid, deptId);
  });

  try {
    tx();
  } catch (e) {
    const message = String(e.message || '').includes('UNIQUE')
      ? 'That department code or HOD email is already in use.'
      : 'Could not create the department.';
    return res.render('admin/department-new', { title: 'New department', error: message });
  }

  res.redirect('/admin');
});

router.post('/departments/:id/archive', (req, res) => {
  archiveDepartment(req.params.id);
  res.redirect('/admin');
});

router.post('/departments/:id/restore', (req, res) => {
  restoreDepartment(req.params.id);
  res.redirect('/admin');
});

// Reset a department head's password. Shown once in the redirect query so
// admin can hand it off; never stored or displayed again after that.
router.post('/departments/:id/reset-hod-password', (req, res) => {
  const department = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
  if (!department || !department.hod_id) return res.redirect('/admin');

  const newPassword = Math.random().toString(36).slice(2, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), department.hod_id);

  const hod = db.prepare('SELECT email FROM users WHERE id = ?').get(department.hod_id);
  res.redirect(`/admin?newPassword=${encodeURIComponent(newPassword)}&forEmail=${encodeURIComponent(hod.email)}`);
});

function courseDepartmentId(courseId) {
  const row = db
    .prepare('SELECT u.department_id as department_id FROM courses c JOIN users u ON u.id = c.faculty_id WHERE c.id = ?')
    .get(courseId);
  return row ? row.department_id : null;
}

router.get('/courses/new', (req, res) => {
  const deptId = req.query.dept || null;
  const facultyList = deptId
    ? db.prepare("SELECT id, name FROM users WHERE role = 'faculty' AND status = 'active' AND department_id = ? ORDER BY name").all(deptId)
    : db.prepare("SELECT id, name FROM users WHERE role = 'faculty' AND status = 'active' ORDER BY name").all();
  res.render('admin/course-new', { title: 'New course', facultyList, deptId, error: null });
});

router.post('/courses', (req, res) => {
  const { code, title, description, faculty_id, dept_id } = req.body;
  const facultyList = dept_id
    ? db.prepare("SELECT id, name FROM users WHERE role = 'faculty' AND status = 'active' AND department_id = ? ORDER BY name").all(dept_id)
    : db.prepare("SELECT id, name FROM users WHERE role = 'faculty' AND status = 'active' ORDER BY name").all();

  if (!code || !title) {
    return res.render('admin/course-new', { title: 'New course', facultyList, deptId: dept_id || null, error: 'Code and title are required.' });
  }

  try {
    db.prepare('INSERT INTO courses (code, title, description, faculty_id) VALUES (?, ?, ?, ?)').run(
      code.trim().toUpperCase(),
      title.trim(),
      description || null,
      faculty_id || null
    );
  } catch (e) {
    return res.render('admin/course-new', { title: 'New course', facultyList, deptId: dept_id || null, error: 'That course code already exists.' });
  }

  res.redirect(dept_id ? '/admin/departments/' + dept_id : '/admin');
});

router.get('/courses/:id/edit', (req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
  if (!course) return res.status(404).render('error', { title: 'Not found', message: 'Course not found.' });
  const facultyList = db.prepare("SELECT id, name FROM users WHERE role = 'faculty' AND status = 'active' ORDER BY name").all();
  const deptId = courseDepartmentId(course.id);
  res.render('admin/course-edit', { title: 'Edit course', course, facultyList, deptId, error: null });
});

router.post('/courses/:id/edit', (req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
  if (!course) return res.status(404).render('error', { title: 'Not found', message: 'Course not found.' });
  const facultyList = db.prepare("SELECT id, name FROM users WHERE role = 'faculty' AND status = 'active' ORDER BY name").all();
  const { title, description, faculty_id } = req.body;
  const deptId = courseDepartmentId(course.id);

  if (!title) {
    return res.render('admin/course-edit', { title: 'Edit course', course, facultyList, deptId, error: 'Title is required.' });
  }

  db.prepare('UPDATE courses SET title = ?, description = ?, faculty_id = ? WHERE id = ?').run(
    title.trim(),
    description || null,
    faculty_id || null,
    course.id
  );
  res.redirect(deptId ? '/admin/departments/' + deptId : '/admin');
});

router.post('/courses/:id/delete', (req, res) => {
  const deptId = courseDepartmentId(req.params.id);
  db.prepare('DELETE FROM courses WHERE id = ?').run(req.params.id);
  res.redirect(deptId ? '/admin/departments/' + deptId : '/admin');
});

// Admin can create additional admin accounts. Faculty, HOD, and student
// accounts are created through the hierarchy (department head creates
// faculty, faculty create students) rather than directly by admin.
router.get('/admins/new', (req, res) => {
  res.render('admin/admin-new', { title: 'New admin', error: null });
});

router.post('/admins', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.render('admin/admin-new', { title: 'New admin', error: 'All fields are required.' });
  }
  try {
    db.prepare('INSERT INTO users (name, email, password_hash, role, created_by) VALUES (?, ?, ?, ?, ?)').run(
      name.trim(),
      email.trim().toLowerCase(),
      bcrypt.hashSync(password, 10),
      'admin',
      req.session.user.id
    );
  } catch (e) {
    return res.render('admin/admin-new', { title: 'New admin', error: 'That email is already registered.' });
  }
  res.redirect('/admin');
});

module.exports = router;
