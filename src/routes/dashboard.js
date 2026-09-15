const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/dashboard', requireAuth, (req, res) => {
  const role = req.session.user.role;
  if (role === 'student') return res.redirect('/student');
  if (role === 'faculty') return res.redirect('/faculty');
  if (role === 'hod') return res.redirect('/hod');
  if (role === 'admin') return res.redirect('/admin');
  res.redirect('/login');
});

module.exports = router;
