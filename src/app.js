const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
require('dotenv').config();

const { attachUser, checkAccountActive } = require('./middleware/auth');
const { urgencyClass, daysUntil } = require('./utils/dates');
const { extractYoutubeId, youtubeEmbedUrl } = require('./utils/youtube');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const studentRoutes = require('./routes/student');
const facultyRoutes = require('./routes/faculty');
const adminRoutes = require('./routes/admin');
const hodRoutes = require('./routes/hod');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, '..', 'data') }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 8,
      httpOnly: true,
      sameSite: 'lax',
    },
  })
);

app.use(attachUser);
app.use(checkAccountActive);
app.locals.urgencyClass = urgencyClass;
app.locals.daysUntil = daysUntil;
app.locals.extractYoutubeId = extractYoutubeId;
app.locals.youtubeEmbedUrl = youtubeEmbedUrl;

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.redirect('/login');
});

app.use(authRoutes);
app.use(dashboardRoutes);
app.use('/student', studentRoutes);
app.use('/faculty', facultyRoutes);
app.use('/hod', hodRoutes);
app.use('/admin', adminRoutes);

app.get('/privacy', (req, res) => res.render('legal/privacy', { title: 'Privacy policy' }));
app.get('/terms', (req, res) => res.render('legal/terms', { title: 'Terms and conditions' }));

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`LMS running at http://localhost:${PORT}`);
});
