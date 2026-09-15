function daysUntil(dueDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + 'T00:00:00');
  return Math.round((due - today) / (1000 * 60 * 60 * 24));
}

function urgencyClass(dueDate, isDone) {
  if (isDone) return 'done';
  const days = daysUntil(dueDate);
  if (days < 0) return 'overdue';
  if (days <= 3) return 'due-soon';
  return '';
}

module.exports = { daysUntil, urgencyClass };
