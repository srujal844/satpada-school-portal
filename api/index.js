const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Load bundled data with fallbacks
let schoolData = {};
try { schoolData = require('../data/school.json'); } catch (e) {
  try { schoolData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'school.json'), 'utf8')); } catch (err) {}
}

let studentsData = [];
try { studentsData = require('../data/students.json'); } catch (e) {
  try { studentsData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'students.json'), 'utf8')); } catch (err) {}
}

let adminData = { username: 'Ashokbhai', password: 'Ashokbhai@123' };
try { adminData = require('../data/admin.json'); } catch (e) {
  try { adminData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'admin.json'), 'utf8')); } catch (err) {}
}

const activeTokens = new Set(['satpada-admin-session-token']);

// Normalize routes (support both /api/... and /...)
app.use((req, res, next) => {
  if (req.url.startsWith('/api/')) {
    req.url = req.url.slice(4); // Remove /api prefix for matching below
  }
  next();
});

// 1. School Info
app.get(['/school', '/school-info'], (req, res) => {
  res.json({
    success: true,
    school: schoolData
  });
});

// 2. Search Result
app.post(['/result/search', '/search'], (req, res) => {
  try {
    const { standard, rollNo, examType } = req.body || {};

    if (!standard || rollNo === undefined || rollNo === null || String(rollNo).trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'ધોરણ (Standard) અને રોલ નંબર (Roll No) દાખલ કરવા ફરજિયાત છે.'
      });
    }

    const reqRoll = parseInt(String(rollNo).trim(), 10);
    const matched = studentsData.find(s => {
      const stdMatch = String(s.standard).trim() === String(standard).trim();
      const sRoll = parseInt(s.rollNo, 10);
      const rollMatch = !isNaN(sRoll) && sRoll === reqRoll;

      if (examType && examType !== 'all') {
        const examMatch = !s.examType || s.examType.toLowerCase() === examType.toLowerCase();
        return stdMatch && rollMatch && examMatch;
      }
      return stdMatch && rollMatch;
    });

    if (!matched) {
      return res.status(404).json({
        success: false,
        message: `ધોરણ ${standard} માં રોલ નંબર ${rollNo} વાળો કોઈ વિદ્યાર્થી મળ્યો નથી. કૃપા કરીને સાચો રોલ નંબર અને ધોરણ ચકાસો.`
      });
    }

    return res.json({
      success: true,
      school: schoolData,
      student: matched
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'સર્ચ કરવામાં સમસ્યા આવી: ' + err.message
    });
  }
});

// 3. Admin Login
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === adminData.username && password === adminData.password) {
    const token = 'satpada-token-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
    activeTokens.add(token);
    return res.json({
      success: true,
      token,
      user: { username: adminData.username, role: 'શાળા સંચાલક / આચાર્યશ્રી (Ashokbhai)' }
    });
  }
  return res.status(401).json({ success: false, message: 'ખોટો યુઝરનેમ અથવા પાસવર્ડ!' });
});

// 4. Admin Students list
app.get('/admin/students', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!activeTokens.has(token) && token !== 'satpada-admin-session-token') {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  res.json({
    success: true,
    total: studentsData.length,
    students: studentsData
  });
});

// Root / health check
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Shree Satpada Prathmik Shala Portal API is active.',
    studentsCount: studentsData.length,
    udiseCode: schoolData.udiseCode || '24140805601'
  });
});

module.exports = app;
