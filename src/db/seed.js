const bcrypt = require('bcryptjs');
const db = require('./index');

function hash(pw) {
  return bcrypt.hashSync(pw, 10);
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (userCount > 0) {
    console.log('Database already has data, skipping seed.');
    return;
  }

  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, role, department_id, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertDept = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)');

  const admin = insertUser.run('Admin User', 'admin@lms.edu', hash('admin123'), 'admin', null, null);

  // Department 1: CSE - fully populated, this is the main demo department.
  const cse = insertDept.run('Computer Science and Engineering', 'CSE');
  const hodCse = insertUser.run('Dr. Meera Iyer', 'hcs@lms.edu', hash('hod123'), 'hod', cse.lastInsertRowid, admin.lastInsertRowid);
  db.prepare('UPDATE departments SET hod_id = ? WHERE id = ?').run(hodCse.lastInsertRowid, cse.lastInsertRowid);

  const faculty1 = insertUser.run('Dr. Sarah Chen', 'schen@lms.edu', hash('faculty123'), 'faculty', cse.lastInsertRowid, hodCse.lastInsertRowid);
  const faculty2 = insertUser.run('Prof. Raj Mehta', 'rmehta@lms.edu', hash('faculty123'), 'faculty', cse.lastInsertRowid, hodCse.lastInsertRowid);

  // Department 2: IT - created empty so the department -> HOD -> faculty ->
  // student creation chain and the archive/restore flow can be tried live
  // without touching the populated demo data in CSE.
  const it = insertDept.run('Information Technology', 'IT');
  const hodIt = insertUser.run('Neha Kapoor', 'hit@lms.edu', hash('hod123'), 'hod', it.lastInsertRowid, admin.lastInsertRowid);
  db.prepare('UPDATE departments SET hod_id = ? WHERE id = ?').run(hodIt.lastInsertRowid, it.lastInsertRowid);

  const studentDefs = [
    ['Aisha Khan', 'aisha@lms.edu'],
    ['Ben Torres', 'ben@lms.edu'],
    ['Priya Nair', 'priya@lms.edu'],
    ['Diego Alvarez', 'diego@lms.edu'],
    ['Emma Wilson', 'emma@lms.edu'],
    ['Farid Hassan', 'farid@lms.edu'],
    ['Grace Lin', 'grace@lms.edu'],
    ['Hana Suzuki', 'hana@lms.edu'],
  ];
  const students = studentDefs.map(([name, email]) =>
    insertUser.run(name, email, hash('student123'), 'student', cse.lastInsertRowid, faculty1.lastInsertRowid)
  );
  const [aisha, ben, priya, diego, emma, farid, grace, hana] = students;

  const insertCourse = db.prepare(
    'INSERT INTO courses (code, title, description, faculty_id) VALUES (?, ?, ?, ?)'
  );

  const cs101 = insertCourse.run(
    'CS101',
    'Introduction to Computer Science',
    'Foundations of programming, algorithms, and computational thinking.',
    faculty1.lastInsertRowid
  );
  const math201 = insertCourse.run(
    'MATH201',
    'Linear Algebra',
    'Vector spaces, matrices, eigenvalues, and applications.',
    faculty2.lastInsertRowid
  );
  const cs210 = insertCourse.run(
    'CS210',
    'Data Structures',
    'Arrays, trees, graphs, and complexity analysis.',
    faculty1.lastInsertRowid
  );
  const phy110 = insertCourse.run(
    'PHY110',
    'Classical Mechanics',
    'Kinematics, Newtonian mechanics, energy, and momentum.',
    faculty2.lastInsertRowid
  );

  const insertEnrollment = db.prepare(
    'INSERT INTO enrollments (course_id, student_id) VALUES (?, ?)'
  );
  [aisha, ben, priya, diego, emma, farid].forEach((s) => {
    insertEnrollment.run(cs101.lastInsertRowid, s.lastInsertRowid);
  });
  [aisha, ben, priya, grace, hana].forEach((s) => {
    insertEnrollment.run(math201.lastInsertRowid, s.lastInsertRowid);
  });
  [aisha, diego, emma].forEach((s) => {
    insertEnrollment.run(cs210.lastInsertRowid, s.lastInsertRowid);
  });
  [ben, farid, grace, hana].forEach((s) => {
    insertEnrollment.run(phy110.lastInsertRowid, s.lastInsertRowid);
  });

  const insertMaterial = db.prepare(
    'INSERT INTO materials (course_id, title, type, content, week_number, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insertMaterial.run(
    cs101.lastInsertRowid,
    'Course Syllabus',
    'link',
    'https://example.edu/cs101/syllabus.pdf',
    0,
    faculty1.lastInsertRowid
  );
  insertMaterial.run(
    cs101.lastInsertRowid,
    'Introduction to Programming with JavaScript',
    'video',
    'https://www.youtube.com/watch?v=W6NZfCO5SIk',
    1,
    faculty1.lastInsertRowid
  );
  insertMaterial.run(
    cs101.lastInsertRowid,
    'Variables and Data Types',
    'note',
    'Covers primitive types, variable declaration, and scope rules. Read chapter 2 before the next session.',
    1,
    faculty1.lastInsertRowid
  );
  insertMaterial.run(
    cs101.lastInsertRowid,
    'JavaScript Control Flow Explained',
    'video',
    'https://www.youtube.com/watch?v=IsG4Xd6LlsM',
    2,
    faculty1.lastInsertRowid
  );
  insertMaterial.run(
    cs101.lastInsertRowid,
    'Control Flow',
    'note',
    'If/else, switch statements, and loop constructs. Practice problems at the end of chapter 3.',
    2,
    faculty1.lastInsertRowid
  );
  insertMaterial.run(
    math201.lastInsertRowid,
    'Matrix Operations Reference',
    'note',
    'Summary of addition, multiplication, and inverse rules with worked examples.',
    1,
    faculty2.lastInsertRowid
  );
  insertMaterial.run(
    cs210.lastInsertRowid,
    'Big-O Notation Cheat Sheet',
    'note',
    'Common time complexities for array, list, tree, and hash operations.',
    1,
    faculty1.lastInsertRowid
  );
  insertMaterial.run(
    phy110.lastInsertRowid,
    'Kinematics Formula Sheet',
    'note',
    'Position, velocity, and acceleration equations for constant and variable acceleration.',
    1,
    faculty2.lastInsertRowid
  );

  const insertAssignment = db.prepare(
    'INSERT INTO assignments (course_id, title, description, due_date, max_points, week_number, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  // CS101: one overdue, one due soon, one future
  const a1 = insertAssignment.run(
    cs101.lastInsertRowid,
    'Assignment 1: Basic Syntax Exercises',
    'Complete exercises 1 through 8 in the workbook. Submit as a single file.',
    daysFromNow(-10),
    100,
    1,
    faculty1.lastInsertRowid
  );
  const a2 = insertAssignment.run(
    cs101.lastInsertRowid,
    'Assignment 2: Control Flow',
    'Write three programs demonstrating loops and conditionals.',
    daysFromNow(2),
    100,
    2,
    faculty1.lastInsertRowid
  );
  const a3 = insertAssignment.run(
    cs101.lastInsertRowid,
    'Assignment 3: Functions and Scope',
    'Implement five small functions covering parameter passing and return values.',
    daysFromNow(14),
    100,
    3,
    faculty1.lastInsertRowid
  );

  // MATH201
  const m1 = insertAssignment.run(
    math201.lastInsertRowid,
    'Problem Set 1: Vector Spaces',
    'Solve problems 1-12 from chapter 3.',
    daysFromNow(-3),
    50,
    1,
    faculty2.lastInsertRowid
  );
  const m2 = insertAssignment.run(
    math201.lastInsertRowid,
    'Problem Set 2: Eigenvalues',
    'Solve problems 1-8 from chapter 5.',
    daysFromNow(9),
    50,
    2,
    faculty2.lastInsertRowid
  );

  // CS210
  const c1 = insertAssignment.run(
    cs210.lastInsertRowid,
    'Assignment 1: Linked List Implementation',
    'Implement a singly linked list with insert, delete, and search operations.',
    daysFromNow(5),
    100,
    1,
    faculty1.lastInsertRowid
  );

  // CS101 quiz: mixed multiple choice + programming, to demo the question system
  const quiz = insertAssignment.run(
    cs101.lastInsertRowid,
    'Week 3 Quiz: Syntax and Logic',
    'Answer the multiple choice section, then write the two short programs. Both sections are submitted together.',
    daysFromNow(7),
    60,
    3,
    faculty1.lastInsertRowid
  );

  // PHY110
  const p1 = insertAssignment.run(
    phy110.lastInsertRowid,
    'Problem Set 1: Kinematics',
    'Solve the ten kinematics problems distributed in lecture.',
    daysFromNow(-1),
    40,
    1,
    faculty2.lastInsertRowid
  );

  const insertQuestion = db.prepare(
    `INSERT INTO questions (assignment_id, type, position, question_text, points, language, starter_code)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertQOption = db.prepare(
    'INSERT INTO question_options (question_id, option_text, is_correct, position) VALUES (?, ?, ?, ?)'
  );
  const insertQTestCase = db.prepare(
    'INSERT INTO question_test_cases (question_id, input, expected_output, position) VALUES (?, ?, ?, ?)'
  );

  function seedMcq(assignmentId, position, text, points, options) {
    const q = insertQuestion.run(assignmentId, 'mcq', position, text, points, null, null);
    options.forEach((o, i) => insertQOption.run(q.lastInsertRowid, o.text, o.correct ? 1 : 0, i));
    return q.lastInsertRowid;
  }
  function seedProgram(assignmentId, position, text, points, language, starterCode, testCases) {
    const q = insertQuestion.run(assignmentId, 'program', position, text, points, language, starterCode);
    (testCases || []).forEach((tc, i) => insertQTestCase.run(q.lastInsertRowid, tc.input, tc.output, i));
    return q.lastInsertRowid;
  }

  // Single-answer MCQ
  seedMcq(quiz.lastInsertRowid, 0, 'Which of the following is NOT a primitive data type in JavaScript?', 10, [
    { text: 'string', correct: false },
    { text: 'number', correct: false },
    { text: 'array', correct: true },
    { text: 'boolean', correct: false },
  ]);
  // True/false, just two options
  seedMcq(quiz.lastInsertRowid, 1, 'True or false: in JavaScript, === checks both value and type.', 10, [
    { text: 'True', correct: true },
    { text: 'False', correct: false },
  ]);
  // Multi-select: more than one correct option
  seedMcq(quiz.lastInsertRowid, 2, 'Which of these are valid ways to declare a variable in modern JavaScript? (select all that apply)', 10, [
    { text: 'let x = 1;', correct: true },
    { text: 'const x = 1;', correct: true },
    { text: 'var x = 1;', correct: true },
    { text: 'variable x = 1;', correct: false },
    { text: 'int x = 1;', correct: false },
  ]);
  // Five options, single answer
  seedMcq(quiz.lastInsertRowid, 3, 'What is the time complexity of looking up a value by key in a hash map, on average?', 10, [
    { text: 'O(n)', correct: false },
    { text: 'O(log n)', correct: false },
    { text: 'O(1)', correct: true },
    { text: 'O(n log n)', correct: false },
    { text: 'O(n^2)', correct: false },
  ]);

  seedProgram(
    quiz.lastInsertRowid, 4,
    'Write a function called sumToN that takes a positive integer n and returns the sum of all integers from 1 to n inclusive.',
    10, 'javascript',
    'function sumToN(n) {\n  // your code here\n}\n',
    [
      { input: 'sumToN(5)', output: '15' },
      { input: 'sumToN(1)', output: '1' },
      { input: 'sumToN(10)', output: '55' },
    ]
  );
  seedProgram(
    quiz.lastInsertRowid, 5,
    'Write a function called reverseString that takes a string and returns it reversed, without using the built-in reverse method.',
    10, 'javascript',
    'function reverseString(str) {\n  // your code here\n}\n',
    [
      { input: 'reverseString("hello")', output: '"olleh"' },
      { input: 'reverseString("a")', output: '"a"' },
    ]
  );

  // The CS210 linked list assignment is a pure programming assignment
  seedProgram(
    c1.lastInsertRowid, 0,
    'Implement a Node class and a LinkedList class with insert(value), delete(value), and search(value) methods. search should return true or false.',
    100, 'javascript',
    'class Node {\n  constructor(value) {\n    this.value = value;\n    this.next = null;\n  }\n}\n\nclass LinkedList {\n  constructor() {\n    this.head = null;\n  }\n\n  insert(value) {\n    // your code here\n  }\n\n  delete(value) {\n    // your code here\n  }\n\n  search(value) {\n    // your code here\n  }\n}\n',
    [
      { input: 'list.insert(3); list.insert(5); list.search(5)', output: 'true' },
      { input: 'list.insert(3); list.delete(3); list.search(3)', output: 'false' },
    ]
  );

  const insertSubmission = db.prepare(
    `INSERT INTO submissions (assignment_id, student_id, content, status, grade, feedback, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))`
  );

  // CS101 A1 (overdue assignment) - mixed completion
  insertSubmission.run(
    a1.lastInsertRowid,
    aisha.lastInsertRowid,
    'Completed all 8 exercises, submitted as text summary.',
    'graded',
    92,
    'Strong work. Minor issue with exercise 6 edge case.',
    '-9 days'
  );
  insertSubmission.run(
    a1.lastInsertRowid,
    ben.lastInsertRowid,
    'Exercises 1-8 completed.',
    'graded',
    78,
    'Watch your indentation style. Otherwise solid.',
    '-8 days'
  );
  insertSubmission.run(
    a1.lastInsertRowid,
    priya.lastInsertRowid,
    'Submitted late due to a family emergency.',
    'late',
    null,
    null,
    '-1 days'
  );
  // diego and emma and farid have not submitted a1 - shows as overdue/not submitted

  // MATH201 m1 (overdue)
  insertSubmission.run(
    m1.lastInsertRowid,
    aisha.lastInsertRowid,
    'Solutions attached, worked through each proof.',
    'graded',
    45,
    'Excellent proof technique on problem 7.',
    '-4 days'
  );
  insertSubmission.run(
    m1.lastInsertRowid,
    grace.lastInsertRowid,
    'All 12 problems solved.',
    'submitted',
    null,
    null,
    '-2 days'
  );

  // PHY110 p1 (overdue)
  insertSubmission.run(
    p1.lastInsertRowid,
    ben.lastInsertRowid,
    'Attached full derivations for each problem.',
    'graded',
    36,
    'Nice, clean derivations.',
    '-1 days'
  );

  const insertAnnouncement = db.prepare(
    'INSERT INTO announcements (course_id, title, body, posted_by) VALUES (?, ?, ?, ?)'
  );
  insertAnnouncement.run(
    cs101.lastInsertRowid,
    'Class moved to Room 204',
    'Starting next week, CS101 lectures will be held in Room 204 instead of the usual hall.',
    faculty1.lastInsertRowid
  );
  insertAnnouncement.run(
    cs101.lastInsertRowid,
    'Assignment 1 grading complete',
    'Grades and feedback for Assignment 1 are posted. Office hours this week if you want to discuss.',
    faculty1.lastInsertRowid
  );
  insertAnnouncement.run(
    math201.lastInsertRowid,
    'Office hours updated',
    'Office hours are now Tuesdays and Thursdays, 2-4pm.',
    faculty2.lastInsertRowid
  );
  insertAnnouncement.run(
    phy110.lastInsertRowid,
    'Midterm date confirmed',
    'The midterm will be held in the third week of next month, covering chapters 1 through 5.',
    faculty2.lastInsertRowid
  );

  // Daily practice questions for CS101: one already released (yesterday),
  // one released today, one scheduled for tomorrow (not visible yet).
  const insertDailyQuestion = db.prepare(
    `INSERT INTO daily_questions (course_id, type, position, question_text, points, language, starter_code, scheduled_date, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertDQOption = db.prepare(
    'INSERT INTO daily_question_options (daily_question_id, option_text, is_correct, position) VALUES (?, ?, ?, ?)'
  );

  function seedDailyMcq(courseId, text, points, date, options) {
    const q = insertDailyQuestion.run(courseId, 'mcq', 0, text, points, null, null, date, faculty1.lastInsertRowid);
    options.forEach((o, i) => insertDQOption.run(q.lastInsertRowid, o.text, o.correct ? 1 : 0, i));
    return q.lastInsertRowid;
  }

  const dq1 = seedDailyMcq(
    cs101.lastInsertRowid,
    'What does the "typeof" operator return for an array in JavaScript?',
    5, daysFromNow(-1),
    [
      { text: '"array"', correct: false },
      { text: '"object"', correct: true },
      { text: '"list"', correct: false },
      { text: '"undefined"', correct: false },
    ]
  );
  insertDailyQuestion.run(
    cs101.lastInsertRowid, 'program', 0,
    'Write a function called isPalindrome(str) that returns true if the string reads the same forwards and backwards.',
    5, 'javascript',
    'function isPalindrome(str) {\n  // your code here\n}\n',
    daysFromNow(0),
    faculty1.lastInsertRowid
  );
  seedDailyMcq(
    cs101.lastInsertRowid,
    'True or false: a do-while loop is guaranteed to run its body at least once.',
    5, daysFromNow(1),
    [
      { text: 'True', correct: true },
      { text: 'False', correct: false },
    ]
  );

  // Aisha already answered yesterday's daily question correctly
  const dq1CorrectOption = db.prepare("SELECT id FROM daily_question_options WHERE daily_question_id = ? AND is_correct = 1").get(dq1);
  const dailyAns = db
    .prepare(
      `INSERT INTO daily_answers (daily_question_id, student_id, is_correct, points_awarded, answered_at)
       VALUES (?, ?, 1, 5, datetime('now', '-1 days'))`
    )
    .run(dq1, aisha.lastInsertRowid);
  db.prepare('INSERT INTO daily_answer_selections (daily_answer_id, daily_question_option_id) VALUES (?, ?)')
    .run(dailyAns.lastInsertRowid, dq1CorrectOption.id);

  // Seed a few activity log entries so the dashboard's recent-activity feed isn't empty on first login
  const insertActivity = db.prepare(
    `INSERT INTO activity_log (user_id, course_id, type, description, created_at)
     VALUES (?, ?, ?, ?, datetime('now', ?))`
  );
  insertActivity.run(aisha.lastInsertRowid, math201.lastInsertRowid, 'enrolled', 'Enrolled in MATH201', '-20 days');
  insertActivity.run(aisha.lastInsertRowid, cs101.lastInsertRowid, 'submitted', 'Submitted Assignment 1: Basic Syntax Exercises', '-9 days');
  insertActivity.run(aisha.lastInsertRowid, cs101.lastInsertRowid, 'graded', 'Received a grade for Assignment 1: Basic Syntax Exercises', '-7 days');
  insertActivity.run(aisha.lastInsertRowid, math201.lastInsertRowid, 'submitted', 'Submitted Problem Set 1: Vector Spaces', '-4 days');

  console.log('Seed complete.');
  console.log('Login credentials:');
  console.log('  Admin:            admin@lms.edu / admin123');
  console.log('  HOD (CSE):        hcs@lms.edu / hod123');
  console.log('  HOD (IT, empty):  hit@lms.edu / hod123');
  console.log('  Faculty:          schen@lms.edu / faculty123');
  console.log('  Faculty:          rmehta@lms.edu / faculty123');
  console.log('  Student:          aisha@lms.edu / student123  (has overdue, due-soon, graded, and future work)');
  console.log('  Student:          ben@lms.edu / student123');
  console.log('  Student:          priya@lms.edu / student123');
  console.log('  Student:          diego@lms.edu / student123');
  console.log('  Student:          emma@lms.edu / student123');
  console.log('  Student:          farid@lms.edu / student123');
  console.log('  Student:          grace@lms.edu / student123');
  console.log('  Student:          hana@lms.edu / student123');
}

seed();
