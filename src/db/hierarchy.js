const db = require('./index');

// Archiving a department cascades to every account in it (hod, faculty,
// students). Rows are never deleted, only marked archived so they can't log
// in; everything they created stays intact.
function archiveDepartment(departmentId) {
  const tx = db.transaction((id) => {
    db.prepare("UPDATE departments SET status = 'archived' WHERE id = ?").run(id);
    db.prepare("UPDATE users SET status = 'archived' WHERE department_id = ?").run(id);
  });
  tx(departmentId);
}

function restoreDepartment(departmentId) {
  const tx = db.transaction((id) => {
    db.prepare("UPDATE departments SET status = 'active' WHERE id = ?").run(id);
    db.prepare("UPDATE users SET status = 'active' WHERE department_id = ?").run(id);
  });
  tx(departmentId);
}

function setUserStatus(userId, status) {
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, userId);
}

module.exports = { archiveDepartment, restoreDepartment, setUserStatus };
