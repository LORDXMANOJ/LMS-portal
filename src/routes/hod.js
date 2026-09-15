const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('hod'));

function myDepartment(req) {
  return db.prepare('SELECT * FROM departments WHERE id = ?').get(req.session.user.department_id);
}

router.get('/', (req, res) => {
  const department = myDepartment(req);
  const faculty = db
    .prepare("SELECT * FROM users WHERE department_id = ? AND role = 'faculty' AND status = 'active' ORDER BY name")
    .all(department.id);
  const archivedFaculty = db
    .prepare("SELECT * FROM users WHERE department_id = ? AND role = 'faculty' AND status = 'archived' ORDER BY name")
    .all(department.id);
  const students = db
    .prepare("SELECT id, name, email, created_at FROM users WHERE department_id = ? AND role = 'student' AND status = 'active' ORDER BY name")
    .all(department.id);

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

  const courseRings = courses.map((c) => {
    const possible = c.student_count * c.assignment_count;
    const actual = db
      .prepare('SELECT COUNT(*) as c FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE a.course_id = ?')
      .get(c.id).c;
    return {
      ...c,
      completionPercent: possible > 0 ? Math.round((actual / possible) * 100) : 0,
    };
  });

  res.render('hod/dashboard', {
    title: 'Department',
    department,
    faculty,
    archivedFaculty,
    students,
    courseRings,
    resetPassword: req.query.newPassword || null,
    resetEmail: req.query.forEmail || null,
  });
});

router.get('/faculty/new', (req, res) => {
  res.render('hod/faculty-new', { title: 'New faculty', error: null });
});

router.post('/faculty', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.render('hod/faculty-new', { title: 'New faculty', error: 'All fields are required.' });
  }
  try {
    db.prepare(
      'INSERT INTO users (name, email, password_hash, role, department_id, created_by) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      name.trim(),
      email.trim().toLowerCase(),
      bcrypt.hashSync(password, 10),
      'faculty',
      req.session.user.department_id,
      req.session.user.id
    );
  } catch (e) {
    return res.render('hod/faculty-new', { title: 'New faculty', error: 'That email is already registered.' });
  }
  res.redirect('/hod');
});

function facultyInMyDeptOr403(req, res, facultyId) {
  const faculty = db.prepare('SELECT * FROM users WHERE id = ?').get(facultyId);
  if (!faculty || faculty.role !== 'faculty' || faculty.department_id !== req.session.user.department_id) {
    res.status(403).render('error', { title: 'Access denied', message: 'You do not manage this faculty account.' });
    return null;
  }
  return faculty;
}

router.post('/faculty/:id/archive', (req, res) => {
  const faculty = facultyInMyDeptOr403(req, res, req.params.id);
  if (!faculty) return;
  db.prepare("UPDATE users SET status = 'archived' WHERE id = ?").run(faculty.id);
  res.redirect('/hod');
});

router.post('/faculty/:id/restore', (req, res) => {
  const faculty = facultyInMyDeptOr403(req, res, req.params.id);
  if (!faculty) return;
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(faculty.id);
  res.redirect('/hod');
});

router.post('/faculty/:id/reset-password', (req, res) => {
  const faculty = facultyInMyDeptOr403(req, res, req.params.id);
  if (!faculty) return;
  const newPassword = Math.random().toString(36).slice(2, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), faculty.id);
  res.redirect(`/hod?newPassword=${encodeURIComponent(newPassword)}&forEmail=${encodeURIComponent(faculty.email)}`);
});

module.exports = router;
