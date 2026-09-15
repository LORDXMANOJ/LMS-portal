-- Student Learning Management System schema

-- Departments are created by admin, each with one head (hod_id).
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  hod_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Role hierarchy: admin > hod > faculty > student.
-- department_id is NULL for admin, set for hod/faculty/student.
-- status='archived' means the account cannot log in but the row (and
-- everything it created) is never deleted, per the no-hard-delete policy.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'faculty', 'hod', 'admin')),
  department_id INTEGER REFERENCES departments(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  faculty_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(course_id, student_id)
);

-- week_number groups course content the way NPTEL/similar course platforms
-- do (Week 0, Week 1, ...). NULL/0 means "general" - not tied to a specific
-- week, shown in its own section ahead of Week 1.
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('note', 'link', 'file', 'video')),
  content TEXT,
  file_path TEXT,
  week_number INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_date TEXT NOT NULL,
  max_points INTEGER NOT NULL DEFAULT 100,
  week_number INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_path TEXT,
  content TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'late', 'graded')),
  grade INTEGER,
  feedback TEXT,
  auto_score INTEGER,
  UNIQUE(assignment_id, student_id)
);

-- Questions belong to an assignment. type = 'mcq' or 'program'.
-- MCQ options live in question_options (any number, any number correct).
-- Program test cases live in question_test_cases (any number).
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('mcq', 'program')),
  position INTEGER NOT NULL DEFAULT 0,
  question_text TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 10,
  language TEXT,
  starter_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS question_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS question_test_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  input TEXT NOT NULL,
  expected_output TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

-- One answer row per (submission, question). MCQ: selections are the join
-- table below. Program: code_answer holds the submitted code.
CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  code_answer TEXT,
  is_correct INTEGER,
  points_awarded INTEGER,
  answered_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(submission_id, question_id)
);

CREATE TABLE IF NOT EXISTS answer_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  answer_id INTEGER NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  question_option_id INTEGER NOT NULL REFERENCES question_options(id) ON DELETE CASCADE,
  UNIQUE(answer_id, question_option_id)
);

-- Daily practice questions, separate from graded assignment questions.
-- Faculty queue these per course with a scheduled_date; a question becomes
-- visible to students once scheduled_date <= today. Editable anytime by any
-- active faculty in the same department as the course's owner.
CREATE TABLE IF NOT EXISTS daily_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('mcq', 'program')),
  position INTEGER NOT NULL DEFAULT 0,
  question_text TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 10,
  language TEXT,
  starter_code TEXT,
  scheduled_date TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_question_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  daily_question_id INTEGER NOT NULL REFERENCES daily_questions(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_question_test_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  daily_question_id INTEGER NOT NULL REFERENCES daily_questions(id) ON DELETE CASCADE,
  input TEXT NOT NULL,
  expected_output TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  daily_question_id INTEGER NOT NULL REFERENCES daily_questions(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_answer TEXT,
  is_correct INTEGER,
  points_awarded INTEGER,
  answered_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(daily_question_id, student_id)
);

CREATE TABLE IF NOT EXISTS daily_answer_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  daily_answer_id INTEGER NOT NULL REFERENCES daily_answers(id) ON DELETE CASCADE,
  daily_question_option_id INTEGER NOT NULL REFERENCES daily_question_options(id) ON DELETE CASCADE,
  UNIQUE(daily_answer_id, daily_question_option_id)
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  posted_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Peer-activity notifications: real events only (a classmate submitted
-- something, hit a streak milestone, or overtook you on a leaderboard) and
-- only sent to a student who is actually behind on that specific thing -
-- never to someone who already did it themselves. message is pre-rendered
-- text chosen from a rotating set of honestly worded phrasings for the same
-- real event - nothing here is fabricated. link_url is where clicking the
-- notification takes the student (the exact assignment/daily question).
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  link_url TEXT,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_student ON notifications(student_id, created_at);

CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);
CREATE INDEX IF NOT EXISTS idx_daily_questions_course ON daily_questions(course_id);
CREATE INDEX IF NOT EXISTS idx_daily_answers_question ON daily_answers(daily_question_id);
CREATE INDEX IF NOT EXISTS idx_daily_question_options_question ON daily_question_options(daily_question_id);
CREATE INDEX IF NOT EXISTS idx_daily_question_test_cases_question ON daily_question_test_cases(daily_question_id);
CREATE INDEX IF NOT EXISTS idx_daily_answer_selections_answer ON daily_answer_selections(daily_answer_id);
CREATE INDEX IF NOT EXISTS idx_questions_assignment ON questions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_question_options_question ON question_options(question_id);
CREATE INDEX IF NOT EXISTS idx_question_test_cases_question ON question_test_cases(question_id);
CREATE INDEX IF NOT EXISTS idx_answers_submission ON answers(submission_id);
CREATE INDEX IF NOT EXISTS idx_answer_selections_answer ON answer_selections(answer_id);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_materials_course ON materials(course_id);
CREATE INDEX IF NOT EXISTS idx_assignments_course ON assignments(course_id);
CREATE INDEX IF NOT EXISTS idx_submissions_assignment ON submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_announcements_course ON announcements(course_id);
