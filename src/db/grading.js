// Exact-match MCQ grading: correct only if the student's selected option set
// is identical to the correct option set (supports single-answer, true/false,
// and multi-select questions with the same rule).
function gradeMcq(selectedIds, correctIds) {
  const sel = new Set(selectedIds.map(String));
  const correct = new Set(correctIds.map(String));
  if (sel.size !== correct.size) return false;
  for (const id of sel) {
    if (!correct.has(id)) return false;
  }
  return true;
}

module.exports = { gradeMcq };
