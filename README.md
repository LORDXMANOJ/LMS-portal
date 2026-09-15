# Coursework — Student Learning Management System

A working prototype of a centralized LMS: a four-tier role hierarchy
(admin → department head → faculty → student), course and enrollment
management, study materials, graded assignments (including MCQ and
programming questions), a separate daily practice-question feed, and
dashboards for every role.

## Stack

- Node.js + Express 5
- SQLite (via `better-sqlite3`), file-based, zero external services
- Server-rendered views with EJS (no client build step)
- Sessions stored in SQLite (`connect-sqlite3`), passwords hashed with bcrypt
- File uploads handled with `multer`

This stack was chosen for a hackathon prototype: no separate frontend build,
no external database service to provision, and the whole thing runs from
`npm install && npm start`.

## Getting started

```bash
npm install
npm run seed    # creates data/lms.db and loads demo accounts + sample courses
npm start        # http://localhost:3000
```

## Demo accounts

| Role                     | Email           | Password   |
|--------------------------|-----------------|------------|
| Admin                    | admin@lms.edu   | admin123   |
| Department head (CSE)    | hcs@lms.edu     | hod123     |
| Department head (IT)     | hit@lms.edu     | hod123     |
| Faculty                  | schen@lms.edu   | faculty123 |
| Faculty                  | rmehta@lms.edu  | faculty123 |
| Student                  | aisha@lms.edu   | student123 |
| Student                  | ben@lms.edu     | student123 |
| Student                  | priya@lms.edu   | student123 |

The **IT** department is seeded empty on purpose — log in as `hit@lms.edu` to
try the department head → faculty → student account-creation chain from
scratch without touching the populated CSE demo data.

`aisha@lms.edu` has a mix of overdue, due-soon, graded, and future assignments
across two courses, seeded relative to today's date, so the dashboard, the
calendar view, and urgency badges have something to show on first login. Five
more student accounts (diego, emma, farid, grace, hana — all @lms.edu, same
password pattern) round out enrollment numbers for the reports view.

To see the question-based assignment flow, log in as `aisha@lms.edu` and open
**Week 3 Quiz: Syntax and Logic** in CS101 — it has four multiple choice
questions and two programming questions seeded. CS210's linked list assignment
is a programming-only example.

See [docs/architecture.html](docs/architecture.html) for a diagram of the
request flow (role check → ownership check → query → render) and the entity
relationships between the six core tables.

## Architecture

```
                       ┌────────────────────┐
                       │   Browser (EJS      │
                       │   server-rendered    │
                       │   HTML, no SPA)      │
                       └─────────┬────────────┘
                                 │ HTTP (session cookie)
                       ┌─────────▼────────────┐
                       │  Express app          │
                       │  src/app.js            │
                       │                        │
                       │  ┌──────────────────┐  │
                       │  │ auth middleware   │  │  role gate: student /
                       │  │ (session-based)   │  │  faculty / hod / admin,
                       │  │                   │  │  + per-request active-
                       │  │                   │  │  account check
                       │  └──────────────────┘  │
                       │  ┌──────────────────┐  │
                       │  │ routes/           │  │
                       │  │  auth.js          │  │
                       │  │  dashboard.js     │  │  role-based redirect
                       │  │  student.js       │  │
                       │  │  faculty.js       │  │
                       │  │  hod.js           │  │
                       │  │  admin.js         │  │
                       │  └──────────────────┘  │
                       └─────────┬────────────┘
                                 │ prepared statements
                       ┌─────────▼────────────┐
                       │  SQLite (data/lms.db)  │
                       │  departments, users,   │
                       │  courses, enrollments,  │
                       │  materials, assignments, │
                       │  questions, answers,     │
                       │  daily_questions,        │
                       │  daily_answers,          │
                       │  submissions,            │
                       │  announcements           │
                       └────────────────────────┘
```

## Database schema

Twelve tables (full definitions in `src/db/schema.sql`):

- **departments** — id, name, code, hod_id, status (`active` / `archived`)
- **users** — id, name, email, password_hash, role (`student` / `faculty` / `hod` / `admin`), department_id, status, created_by
- **courses** — id, code, title, description, faculty_id (owner)
- **enrollments** — join table: course_id + student_id, unique pair
- **materials** — course_id, title, type (`note` / `link` / `file`), content, file_path
- **assignments** — course_id, title, description, due_date, max_points
- **questions** — assignment_id, type (`mcq` / `program`), position, question_text, points, language, starter_code
- **question_options** — question_id, option_text, is_correct, position — any number of rows per question, any number marked correct
- **question_test_cases** — question_id, input, expected_output, position — any number of example test cases per programming question
- **answers** — submission_id + question_id (unique pair), code_answer for programming, is_correct and points_awarded filled in by auto-grading
- **answer_selections** — answer_id + question_option_id (unique pair) — which options a student checked, supporting any number of selections
- **daily_questions** — course_id, type, question_text, points, scheduled_date, language, starter_code — a separate practice-question queue, not tied to a graded assignment
- **daily_question_options** / **daily_question_test_cases** / **daily_answers** / **daily_answer_selections** — same shapes as the assignment-question tables above, mirrored for the daily queue
- **submissions** — assignment_id + student_id (unique pair), content, file_path, status, grade, feedback, auto_score
- **announcements** — course_id, title, body
- **activity_log** — user_id, course_id, type, description — powers the "recent activity" feed on the student dashboard

### Admin's view is department-first, not a flat course list

The admin dashboard (`/admin`) shows departments only — each row's head,
active faculty count, and active student count. There is no system-wide
course table on that page. Clicking into a department
(`/admin/departments/:id`) shows that department's courses (a course's
department is derived from its faculty owner, not a separate column) and one
aggregate performance view: a ring showing the percentage of possible
assignment submissions actually completed across the whole department,
plus the average grade across every graded submission in it. This is
deliberately a department-wide number, not a per-student breakdown — admin
sees how a department is doing as a whole, not any individual's grades.
Creating, editing, or deleting a course from that page stays scoped to the
department you're looking at (the faculty picker only lists that
department's faculty, and every action redirects back to the same page).

### Role hierarchy and account creation

Roles nest strictly: **admin → department head (hod) → faculty → student.**
Each tier creates the accounts directly below it, and only that tier can
manage them:

- **Admin** creates a **department** and its **department head** together in
  one step (`/admin/departments/new`) — there is no separate "create a HOD"
  action, since a department always has exactly one head. Admin's own view
  (`/admin`) lists departments only, never a flat cross-department course
  list; opening a department (`/admin/departments/:id`) shows its courses
  and one aggregate performance ring, not per-student data.
- **Department head** creates **faculty** accounts within their own
  department (`/hod/faculty/new`), and can see (read-only) every student in
  the department plus a completion ring per course — not individual student
  grades.
- **Faculty** creates **student** accounts within their own department
  (`/faculty/students/new`). Any active faculty member in a department can
  manage any student in that department — account management isn't scoped
  to whoever happens to have created it.

Enforcement is layered the same way the rest of the app is: route-level
`requireRole()` gates a whole route tree, then a department-membership check
(`facultyInMyDeptOr403`, `studentInMyDeptOr403`, `courseInMyDeptOr403`) stops
a HOD or faculty member from touching an account or course outside their own
department, even with a guessed URL. This was verified directly: a
department head from one department gets a 403 archiving a faculty member in
another department, and a faculty member gets a 403 opening a course's daily
question queue outside their department.

### No hard deletes — only archive and restore

Nothing in the hierarchy is ever deleted. "Delete" actions archive instead:
the row stays exactly as it was, `status` flips to `archived`, and the
account can no longer log in. A restore action reverses it.

- **Admin** archives a whole **department** — this cascades to the
  department's head, every faculty member, and every student in it, all in
  one transaction. Restoring the department restores all of them together.
- **Department head** archives an individual **faculty** account — the
  faculty member's courses, materials, and assignments stay exactly as they
  were; only their ability to log in is removed.
- **Faculty** archives an individual **student** account, freely, without
  going through anyone else.

Archiving isn't just a next-login check: a small middleware
(`checkAccountActive`) runs on every request for a logged-in user and
re-checks their status against the database, so archiving someone with a
live session logs them out on their very next request — verified directly by
archiving a student mid-session and confirming their next request bounced to
`/login`.

### Password handling

Passwords are hashed with bcrypt and never stored or displayed in plain
text — not even to the tier that created the account. Instead, each tier can
**reset** the password of an account it manages; the new one is generated
server-side and shown exactly once, in the page the reset redirects to, for
the admin/HOD/faculty member to hand off. It is never logged or shown again
after that.

## End-to-end flow implemented

1. **Admin** creates a department, which creates its department head in the
   same step (`/admin/departments/new`)
2. **Department head** logs in and creates a faculty account
   (`/hod/faculty/new`)
3. **Faculty** logs in, creates student accounts (`/faculty/students/new`),
   creates a course is done by admin assigning them as owner, then the
   faculty member enrolls students, posts materials, creates an assignment
   with a due date, and posts an announcement
4. **Student** sees the course and assignment appear on their dashboard,
   opens the assignment, and submits a written response, a file, or answers
   to MCQ/programming questions
5. **Faculty** reviews the submission and records a grade and feedback
6. **Student** sees the grade and feedback on the assignment page
7. **Faculty** views a participation report per course (submission counts,
   average grade per assignment, per-student completion)

## Question-based assignments

An assignment can either be a plain free-text/file submission (the original
behaviour, still supported) or carry a set of **questions**, mixing both
types freely:

- **Multiple choice** — any number of options (2 or more), any number of
  them marked correct. Two options makes it true/false; checking more than
  one correct option makes it multi-select. Grading is exact-match: a
  student's selected set must equal the correct set exactly, or the question
  is marked wrong (no partial credit). Options live in their own
  `question_options` table, not fixed A–D columns, so faculty aren't boxed
  into four choices.
- **Programming** — a prompt plus a CodeMirror editor with syntax
  highlighting, auto-closing brackets, bracket matching, and auto-indent on
  Enter. Faculty pick the language (JavaScript, Python, Java, C++), can
  supply starter code, and can attach any number of example input/expected-
  output test cases (`question_test_cases`). Test cases are shown to the
  student as a guide — nothing executes the submitted code, so faculty still
  grade it by reading it.

**Question building has its own dedicated pages** (`/faculty/assignments/:id/questions/mcq/new`,
`.../program/new`, and `/faculty/questions/:id/edit`) rather than inline
forms buried at the bottom of the assignment page — add/remove option rows
and test-case rows with JS, no fixed row count. Editing a question replaces
its whole option or test-case set in one transaction.

**Taking an assignment is a full-page, one-question-at-a-time experience**:
tabs still separate "Multiple choice" from "Programming," but within each
tab every question — MCQ or programming — gets its own full-viewport split
view (question on the left, answer/typing area on the right, dragged wider
or narrower with the divider between them) instead of a small card in a
scrolling page. A floating Previous/Next/Submit cluster stays fixed in the
bottom-right corner so navigating the quiz never requires scrolling to find
a button. All questions across both tabs still post together as one
submission when "Submit answers" is clicked.

Grading is hybrid: multiple choice is auto-scored into `submissions.auto_score`
on submit, and faculty can still open the submission, read the code answers,
and set a final overriding grade with feedback. `/faculty/submissions/:id/answers`
shows a per-question breakdown of what the student chose, what was correct
(students themselves never receive `is_correct` in the page data — only the
question text and option text), and the code they wrote.

The editor degrades gracefully — if the CodeMirror CDN is unavailable, the
underlying `<textarea>` stays visible and the form still submits.

## Daily practice questions

Separate from graded assignments, faculty can queue MCQ or programming
questions per course with a **release date** (`/faculty/courses/:id/daily`),
using the same variable-option / test-case question builder as assignments.
A question becomes visible to enrolled students once its date arrives.

`/student/daily` shows one released question at a time, oldest-first, in the
same full-page split view as assignments — `?i=` selects which one, and
Previous/Next are plain links so paging through them never loses your place.
Any active faculty member in the department can edit a queued question at
any time, including ones already released. MCQ answers auto-grade the same
way assignment MCQs do; programming answers are stored for faculty review
via a per-student answer page.

## Beyond the minimum flow

- Due-date urgency (overdue / due soon) surfaced as badges on the student
  dashboard, course page, and a dedicated calendar/timeline view
- Course and assignment edit (not just create) for faculty; admin can
  reassign a course's faculty owner
- Bulk enrollment by pasting a list of student emails
- File uploads for course materials, not just assignment submissions
- A faculty-wide "all submissions" view across every course they teach
- CSV export of a course's participation report
- A student activity log (enrolled / submitted / graded events)

## What's deliberately out of scope for the prototype

- Email delivery (password resets are shown on-screen once rather than emailed)
- Real-time notifications (announcements are pull, not push)
- File type/virus scanning on uploads beyond a size limit
- Multi-tenant support across separate institutions (one hierarchy of
  departments per deployment)
