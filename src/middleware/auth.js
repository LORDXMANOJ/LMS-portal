const db = require('../db');

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('error', {
        title: 'Access denied',
        message: 'You do not have permission to view this page.',
        user: req.session.user,
      });
    }
    next();
  };
}

function attachUser(req, res, next) {
  res.locals.user = req.session.user || null;
  res.locals.currentPath = req.path;
  next();
}

// If an account gets archived while its session is still alive (e.g. a
// faculty member archives a student mid-session), the next request should
// log them out rather than let a stale session keep working.
function checkAccountActive(req, res, next) {
  if (!req.session.user) return next();
  const row = db.prepare('SELECT status FROM users WHERE id = ?').get(req.session.user.id);
  if (!row || row.status !== 'active') {
    return req.session.destroy(() => {
      res.redirect('/login');
    });
  }
  next();
}

module.exports = { requireAuth, requireRole, attachUser, checkAccountActive };
