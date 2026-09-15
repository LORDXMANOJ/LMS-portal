# Manual testing guide

Walk through this top to bottom in order — later steps assume earlier ones
happened (e.g. the leaderboard test needs the streak test done first). Each
step says what to do and what you should see. If something doesn't match,
that's a bug to report.

## 0. Setup

```
npm install
npm run seed    # wipes and recreates data/lms.db with demo data — safe to rerun anytime
npm start        # http://localhost:3000
```

If you ever want to reset back to a clean starting point mid-testing:
```
rm data/lms.db data/lms.db-shm data/lms.db-wal data/sessions.db
npm run seed
```

**Demo accounts** (all passwords shown, all @lms.edu):

| Role | Email | Password | Notes |
|---|---|---|---|
| Admin | admin@lms.edu | admin123 | |
| Department head | hcs@lms.edu | hod123 | Heads CSE — fully populated |
| Department head | hit@lms.edu | hod123 | Heads IT — seeded empty on purpose |
| Faculty | schen@lms.edu | faculty123 | Owns CS101, CS210 |
| Faculty | rmehta@lms.edu | faculty123 | Owns MATH201, PHY110 |
| Student | aisha@lms.edu | student123 | Has a 1-day streak, overdue/due-soon/graded work seeded |
| Student | ben@lms.edu | student123 | |
| Student | priya@lms.edu, diego@lms.edu, emma@lms.edu, farid@lms.edu, grace@lms.edu, hana@lms.edu | student123 | Fill out the roster/leaderboard |

---

## 1. Login and access control

1. Go to `http://localhost:3000` — should redirect to `/login`.
2. Try a wrong password for any account — should show "Incorrect email or
   password," not say which part was wrong.
3. Log in as `aisha@lms.edu`. You land on `/student`.
4. While still logged in as a student, manually type `http://localhost:3000/admin`
   in the address bar — should get a 403 "Access denied" page, not the admin
   dashboard.
5. Log out (top-right). Try the browser back button — you should be bounced
   back to login, not shown a cached page.

---

## 2. Admin: departments and courses

Log in as `admin@lms.edu`.

1. The sidebar shows just "Admin." The dashboard shows department cards
   (CSE, IT) with head/faculty/student counts — **no flat course list** on
   this page.
2. Click into **CSE**. You should see:
   - Faculty/student/course counts
   - An **overall performance ring** (a donut chart with a percentage in
     the middle) plus an average-grade number below it
   - A list of CSE's courses (CS101, MATH201, CS210, PHY110)
3. Click into **IT** — it's seeded empty, so you should see a 0% ring and
   "no courses yet," not an error.
4. Click **New department**. Fill in a name, code, and a department head's
   name/email/password, submit. You should land back on `/admin` and see
   the new department listed.
5. Log out, log in as the head account you just created — it should work
   immediately.
6. Back as admin: on the CSE department page, click **New course**, create
   one, assign a faculty owner from the dropdown (only CSE faculty should
   be listed). Confirm it appears in CSE's course list.
7. Archive the department you created in step 4 (button on the admin
   dashboard). Confirm:
   - The head account can no longer log in (try it — should say "This
     account has been deactivated")
   - The department still appears under "Archived departments" on the
     admin dashboard, not gone entirely
8. Restore it — the head should be able to log in again.

---

## 3. Department head (HOD)

Log in as `hcs@lms.edu` (heads CSE).

1. Sidebar shows "Department." The dashboard shows:
   - Every student in CSE, read-only (no edit/delete buttons on students —
     HOD doesn't manage students directly)
   - **One performance ring per course** in CSE (not a single combined
     ring)
   - A list of CSE's faculty with Reset password / Archive buttons
2. Click **New faculty**, create one. Log out, log in as that new faculty
   account — should work.
3. Back as HOD: **Reset password** on an existing faculty member. You
   should see the new password shown once on the page. Log out, confirm
   the *old* password no longer works and the new one does.
4. **Archive** a faculty member. Confirm they can't log in, but their
   courses/materials are untouched (check as admin or another faculty
   account that their course still exists with all its content).
5. Restore them.
6. Log in as `hit@lms.edu` (heads the empty IT department) — dashboard
   should show zero faculty, zero students, "no courses yet," with no
   errors.

---

## 4. Faculty: course setup

Log in as `schen@lms.edu`.

1. Sidebar shows Dashboard / Students / Submissions.
2. Open **CS101**. You should see week-grouped sections (General, Week 1,
   Week 2, Week 3) as collapsible blocks — click one closed, click it open
   again.
3. Under **Add material**, create a material with type **Video (YouTube)**,
   paste a real YouTube URL (e.g. `https://www.youtube.com/watch?v=dQw4w9WgXcQ`),
   set a week number, submit. Confirm it appears embedded and playable in
   that week's section.
4. Try adding a video material with a bogus URL like "not a url" — should
   be rejected with an error, not silently saved.
5. Add a plain **Note** and a **Link** material too, in different weeks.
6. Under **Add assignment**, create one with a due date and a week number.
   Confirm it shows up under the right week, with an Edit link and a
   Delete button (with a confirmation prompt).
7. Go to **Students** (sidebar). Create a new student account. Log in as
   that student in a separate browser/incognito window — should work
   immediately, and they should see no courses yet (not enrolled anywhere).
8. Back on CS101's page, enroll that new student — either the single
   dropdown or paste their email into **Bulk enroll**. Confirm they show
   up in the student list.
9. **Archive** a student from the Students page. Confirm they can't log in.
   Restore them.

---

## 5. Faculty: building a graded assignment (MCQ + programming)

Still logged in as `schen@lms.edu`, open the seeded **Week 3 Quiz: Syntax
and Logic** in CS101 (or use the assignment you created above).

1. Click **Add multiple choice question** — this should open its own
   dedicated page, not an inline form buried on the course page.
2. Add a question with only 2 options, mark one correct — this is a
   true/false question. Submit.
3. Add another with 5 options and **two** marked correct — this tests
   multi-select. Try submitting with zero options checked — should be
   rejected ("mark at least one as correct").
4. Go back to the assignment page, confirm both new questions show up with
   their correct answers marked.
5. Click **Edit** on one of them, change an option's text and which one is
   correct, save. Confirm the change stuck.
6. Click **Add programming question**. Add a prompt, pick a language, add
   two or three test cases (input / expected output pairs) using **Add
   test case**, and some starter code. Submit and confirm it shows on the
   assignment page with the test case count.
7. **Delete** one question (confirmation prompt should appear) and confirm
   it's gone.

---

## 6. Student: taking the quiz

Log in as `aisha@lms.edu`, open the same **Week 3 Quiz** from her
dashboard or CS101's page.

1. You should land on a **full-page split view**: question on the left,
   answer area on the right, with a **draggable divider** between them —
   try dragging it and confirm the split resizes.
2. Two tabs at top: "Multiple choice (N)" and "Programming (N)." Click
   Programming — the multiple-choice content should completely disappear,
   not stay visible underneath.
3. Click back to Multiple choice. Use the **Next**/**Previous** buttons
   (fixed bottom-right) to move through questions one at a time — only one
   question should be visible at any time, never a scrolling list of all
   of them.
4. On the true/false question you added, confirm it renders as checkboxes
   (not radio buttons) — check one.
5. On the multi-select question, check two boxes.
6. Switch to the Programming tab. Type in the code editor:
   - Type an opening `{` — a matching `}` should auto-insert.
   - Press Enter inside a block — the cursor should land at the correct
     indent level, not column 0.
   - Confirm the test cases you added are visible in the question panel
     on the left.
7. Click **Submit answers**. You should land back on the same page with:
   - An **MCQ auto-score** shown (computed instantly, before any faculty
     grading)
   - Your checked options still shown as checked if you reload the page
8. As a grading-accuracy check: submit the multi-select question with only
   one of the two correct boxes checked (not both) — confirm it's graded
   *wrong*, not partially correct. This is intentional (exact-match
   grading only).
9. Go to **Assignment 2** (a plain, non-question assignment) from CS101 —
   confirm the old-style written-response + file-upload form still works
   (type something, submit, reload, confirm it saved).

---

## 7. Student: daily questions and streaks

Still as `aisha@lms.edu`.

1. Click **Daily questions** in the sidebar. You land on a single released
   question (oldest first), same full-page split layout as the quiz.
2. Check the streak badge next to your name in the top bar — it should be
   **amber** if you haven't answered today's question yet.
3. Answer the current question, submit.
4. Confirm:
   - The badge turns **green**
   - The dashboard's streak stat tile number went up by one
   - The "keep your streak going" nudge card on the dashboard is gone
5. Use **Next**/**Previous** at the bottom-right to move between daily
   questions — confirm your place is kept correctly (URL should show
   `?i=` changing).
6. Go to **Profile** (sidebar) — confirm your name, email, department,
   enrolled courses, and current streak all show correctly.

---

## 8. Student: leaderboard

1. From any enrolled course page, click **Leaderboard**.
2. Confirm you (Aisha) show up with a **"(you)"** tag and a highlighted
   row.
3. Log in as a *different* student in another browser/incognito tab (e.g.
   `ben@lms.edu`), answer today's daily question for a shared course, then
   reload the leaderboard as Aisha — Ben's rank/streak should reflect the
   new answer.
4. Try opening the leaderboard URL for a course you're **not** enrolled in
   (guess a course ID or check the CSE department page as admin for IDs) —
   should be a 403, not a leak of that course's rankings.

---

## 9. Faculty: grading and reports

Log in as `schen@lms.edu` again.

1. Go to **Submissions** (sidebar) — confirms you can see every submission
   across every course you teach in one list.
2. Open the Week 3 Quiz assignment, **Submissions** tab. Find Aisha's
   submission. Click **View question answers** — confirm it shows exactly
   which options she picked, whether each was right, and her submitted
   code for the programming questions.
3. Enter a grade and feedback, save. Log back in as Aisha and confirm the
   grade and feedback show on her assignment page, alongside the earlier
   auto-score (both should be visible, not one overwriting the other).
4. Open CS101's **Daily questions** page — if any students haven't
   answered today's question, you should see a list of their names in an
   amber callout at the top. Answer it as one of those students, reload,
   confirm they drop off the list.
5. Go to a course's **View report** — confirm submission counts and
   average grade per assignment look right, and **Export CSV** downloads a
   file that actually opens with the right numbers in it.

---

## 10. Visual/theme check

This part is just looking at it, not clicking through logic:

1. Confirm the whole site uses the light background / white cards / blue
   accent / rounded (not sharp, not pill-shaped) cards and buttons theme —
   no purple, no gradients.
2. Confirm big numbers (stat tiles, due dates, the streak badge) render in
   a distinct **monospace** font, different from the body text font.
3. Confirm the left sidebar appears and highlights the current section for
   **all four roles** (admin, HOD, faculty, student) — not just students.
4. Resize the browser to a narrow/phone width — the sidebar should
   collapse to a horizontal scrollable strip at the top instead of eating
   half the screen.
5. Check `/privacy` and `/terms` load and have real content, not
   placeholder text.

---

## 11. Things that should NOT work (negative tests)

- A student editing the URL to hit any `/faculty/*`, `/hod/*`, or
  `/admin/*` page → 403.
- A faculty member from one department opening a course-management page
  for another department's course → 403.
- A department head trying to archive a faculty member in a *different*
  department → 403.
- Submitting the MCQ question-builder form with fewer than 2 options, or
  no option marked correct → rejected with an error, not silently
  accepted.
- Visiting any nonexistent URL → a proper 404 page, not a crash.

---

If everything above matches what's described, the app is working as
built. If anything differs, note the exact step number, what you expected,
and what actually happened.
