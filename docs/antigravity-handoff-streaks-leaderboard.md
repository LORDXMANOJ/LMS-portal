# Handoff: Streaks + Leaderboard for Daily Questions — STATUS: BUILT

## Who this is for

You (the AI agent, e.g. Antigravity) have no memory of prior conversation
about this project. Read this whole file before touching any code.

**Update: the feature this file originally asked for has already been
built and tested.** This file now documents what exists, exactly where, and
a short list of optional follow-on ideas — it is no longer a build spec.
Don't rebuild any of the items in "What was built" below; extend them
instead, per "Ideas for a next pass" at the end.

## What this app is

"Coursework" is a Student Learning Management System prototype at
`C:\GAMES FOLDER\LMS`. Stack: Node.js + Express 5, SQLite via
`better-sqlite3` (file-based, no external DB service), server-rendered EJS
views (no frontend framework, no build step), sessions in SQLite via
`connect-sqlite3`, passwords hashed with bcrypt.

Run it with:
```
npm install
npm run seed    # wipes/recreates data/lms.db with demo data — safe to rerun
npm start        # http://localhost:3000
```

Four roles, strictly hierarchical: **admin → department head (hod) →
faculty → student**. Demo logins (full list in `README.md`):
- Student: `aisha@lms.edu` / `student123` (has one day of daily-answer
  history seeded, so her streak starts at 1 on a fresh seed)
- Faculty: `schen@lms.edu` / `faculty123`

Read `README.md` at the project root first — it documents the whole schema
and every route in detail.

## What was built

The goal: make students want to answer daily practice questions every day,
using loss-aversion and light social pressure — deliberately not reminder
emails, not badges/achievements/confetti (both explicitly rejected as
over-engineered gamification). Three pieces landed:

### 1. Streak calculation — `src/db/streaks.js`

`getStreak(studentId)` returns `{ current, longest, answeredToday, alive }`.
A streak counts consecutive **calendar days (UTC)** on which a student
answered at least one daily question (any course, any type), sourced from
`daily_answers.answered_at`. "Alive" means the most recent answered date is
today or yesterday, so the number doesn't visually collapse to 0 the moment
midnight passes before a student has had a chance to answer today.

**Important implementation detail, already fixed once — don't reintroduce
it:** all date arithmetic in this file uses `Date.UTC` explicitly via a
`dateToUtcDays()` helper, and never mixes local-time `Date` construction
with `.toISOString()`. An earlier draft built `cursor = new Date(dateStr +
'T00:00:00')` (parsed as **local** time) then called `.toISOString()`
(which converts to **UTC**) — in any timezone ahead of UTC (e.g. IST,
UTC+5:30) this silently produced an off-by-one day and broke multi-day
streak counting (a verified 3-day streak came back as 1). It was caught by
writing a throwaway `node -e "..."` test against real inserted rows and
comparing the expected vs. actual streak count — if you touch this file,
re-run an equivalent manual test with a synthetic 3-consecutive-day
answer history before trusting it.

### 2. Streak surfaced to the student, in three places

- **`src/routes/student.js`** — a router-level middleware right after
  `router.use(requireRole('student'))` calls `getStreak()` once per request
  and sets `res.locals.streak`, so it's available in every student view
  without each route handler wiring it in individually.
- **`views/partials/nav.ejs`** — a small badge next to the student's name,
  visible on every page. Amber (`.streak-pending`, uses `--warn-bg`/
  `--warn-text`) if today isn't answered yet, green (`.streak-done`, uses
  `--ok-bg`/`--ok-text`) once it is — this color flip is the actual
  loss-aversion nudge, not text. Styles are in `public/css/style.css` right
  after the `.nav-user`/`.role-tag` block.
- **`views/student/dashboard.ejs`** — a streak stat tile in the existing
  `.stats-row` (now first in that row, ahead of "Enrolled courses"), plus a
  conditional nudge card right below the stats: amber "keep your streak
  going" if a streak exists but today isn't done, or a neutral "start a
  streak" prompt if the streak is 0. Both link straight to `/student/daily`.
- **`views/student/daily.ejs`** — after `streak.answeredToday` is true, a
  one-line "N days in a row — today's done" confirmation appears right in
  the page header, so the payoff is visible immediately after submitting
  without navigating anywhere else.

### 3. Class leaderboard — `/student/courses/:id/leaderboard`

- **Route**: `src/routes/student.js`, `GET /courses/:id/leaderboard`,
  placed right after the existing `GET /courses/:id` handler. Copies that
  handler's exact enrollment-check pattern (`SELECT 1 FROM enrollments
  WHERE course_id = ? AND student_id = ?`, 403 if not enrolled) — verified
  a non-enrolled student gets a 403, not just a hidden link.
- Ranks every **active** enrolled student in the course by current streak,
  tie-broken by total daily questions answered in that course, then by
  name. Computed with `getStreak()` per student (cheap — small per-student
  row counts, no N+1 concern at this scale) plus one `COUNT` query per
  student for the tie-break.
- **View**: `views/student/leaderboard.ejs` — a plain ranked `<table>`
  (matches the styling already used in `views/student/calendar.ejs` and
  `views/faculty/report.ejs`), with the viewing student's own row
  highlighted via `--accent-tint` background and a "(you)" label.
- Linked from `views/student/course.ejs` via a "Leaderboard" button near the
  top of the page.

### 4. Faculty-visible "who hasn't answered today" (the optional item — also built)

- **Route**: `src/routes/faculty.js`, inside the existing `GET
  /courses/:id/daily` handler (the daily-question queue page). Filters that
  course's daily questions to ones scheduled for today, then diffs enrolled
  students against `daily_answers` to find who hasn't answered any of
  today's question(s) yet. Mirrors the same enrolled-vs-answered diff
  pattern already used for `notSubmitted` in the assignment-submissions
  handler (`GET /assignments/:id` in the same file) — same shape, applied
  to daily answers instead of assignment submissions.
- **View**: `views/faculty/daily-queue.ejs` — an amber card at the top
  listing names, only rendered when the list is non-empty and only when
  there's a question scheduled for today (a course with nothing due today
  shows nothing, not an empty card).

## Design rules that were followed — keep following them

- No purple gradients, no pill-shaped buttons, no fake reviews/metrics, no
  vague hero text, no emoji icons, no em dashes, no over-the-top scroll
  animations, no AI-slop photos/copy, no cursor animations, no fake
  customer counters. No badges, no achievement pop-ups, no confetti.
- Palette is CSS custom properties at the top of `public/css/style.css`
  (`--accent`, `--accent-tint`, `--warn-bg`, `--warn-text`, `--ok-bg`,
  `--ok-text`, `--border`, `--text-muted`, etc.) — every new style added
  above reused these, never hardcoded a new color.
- Buttons use `.btn` / `.btn-primary` / `.btn-sm`, sharp corners
  (`--radius: 3px`), no rounded-pill shapes. Font is Inter.
- Every number shown is a real SQL query result — nothing here is a
  placeholder or hardcoded value.

## Verification already performed (re-run if you change any of this)

Tested via `curl` against a running dev server (no headless browser was
available in that environment, so this was request/response + direct
sqlite inspection, not a visual check):
- Streak math: 0-answer case, a verified 3-consecutive-day streak (3, not
  the buggy 1), a 2-day streak with an earlier isolated answer 5 days back
  correctly not merging into the count, and the seeded 1-day case for
  `aisha@lms.edu`.
- Dashboard tile and nav badge both render the right number and the nav
  badge's amber/green state flips correctly after answering today's
  question (streak went 1 → 2, badge flipped `streak-pending` →
  `streak-done`, nudge card disappeared).
- Leaderboard: correct rank order, "(you)" tag on the right row, and a
  403 for a student not enrolled in that course.
- Faculty "not answered today" list: correctly listed the two students who
  hadn't answered and excluded the one who had; correctly rendered nothing
  for a course with no question scheduled today.
- Full regression pass across all four roles (admin/hod/faculty/student)
  confirmed nothing else broke — every previously-working route still
  returns its expected status code.
- Database was reset to a clean seeded state after testing (`rm -f
  data/lms.db data/lms.db-shm data/lms.db-wal data/sessions.db && npm run
  seed`).

**Not verified**: actual rendered appearance in a real browser (no headless
browser tool was available in the environment this was built in) — worth a
manual look before considering this fully signed off, especially the
draggable-divider and floating-nav-button interactions on the daily
question page, and the amber/green nav badge colors in both light and dark
system themes if this app ever gets a dark mode.

## Ideas for a next pass (not started, your call whether any are worth it)

- A compact "your rank in each course" widget directly on the student
  dashboard, so a student sees "4th in CS101" without clicking into the
  course. Mentioned as optional in the original ask; skipped here to keep
  scope tight.
- The leaderboard currently only ranks by daily-question streak/count, not
  overall assignment performance. Whether that's desirable is a product
  call, not a bug — daily questions are the low-friction habit-forming
  surface; assignments are graded work and mixing the two rankings could
  muddy the signal.
- No per-course "reset" if a student's answer to an old daily question gets
  edited later — the streak always reflects current `daily_answers` state,
  which is correct behavior, just noting it in case someone expects
  historical immutability.
