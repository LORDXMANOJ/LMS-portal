const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('auth/login', { error: null, title: 'Log in' });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').trim().toLowerCase());

  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).render('auth/login', {
      error: 'Incorrect email or password.',
      title: 'Log in',
    });
  }

  if (user.status !== 'active') {
    return res.status(403).render('auth/login', {
      error: 'This account has been deactivated. Contact your department for access.',
      title: 'Log in',
    });
  }

  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    department_id: user.department_id,
  };
  res.redirect('/dashboard');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
