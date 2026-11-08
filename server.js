const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const STUDENTS_FILE = path.join(DATA_DIR, 'students.json');
const SCHOOL_FILE = path.join(DATA_DIR, 'school.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const PERMANENT_DB = path.join(DATA_DIR, 'students_permanent.db');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

// Active admin sessions
const activeAdminTokens = new Set(['satpada-admin-session-token']);

// Helper to read JSON (safely handles UTF-8 BOM)
function readJson(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf-8');
      if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
      }
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
  }
  return defaultValue;
}

// Helper to write JSON
function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
    return false;
  }
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'srujal844/satpada-school-portal';

// Background Cloud Sync to GitHub (Ensures 24/7 persistence across restarts)
let isSyncing = false;
async function syncDatabaseToCloud(students) {
  if (!GITHUB_TOKEN || !GITHUB_REPO || isSyncing) return;
  isSyncing = true;
  try {
    const content = Buffer.from(JSON.stringify(students, null, 2), 'utf-8').toString('base64');
    const headers = {
      'Authorization': 'Bearer ' + GITHUB_TOKEN,
      'User-Agent': 'Satpada-Portal-CloudSync',
      'Accept': 'application/vnd.github.v3+json'
    };

    const getRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/data/students.json`, { headers });
    let sha = undefined;
    if (getRes.status === 200) {
      const getData = await getRes.json();
      sha = getData.sha;
    }

    const putRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/data/students.json`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `Cloud Database Auto-Sync (${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })})`,
        content,
        sha
      })
    });

    if (putRes.status === 200 || putRes.status === 201) {
      console.log(`☁️ Cloud Sync: Successfully synced ${students.length} students to GitHub database!`);
    } else {
      console.error('Cloud Sync warning:', putRes.status);
    }
  } catch (err) {
    console.error('Cloud Sync error:', err.message);
  } finally {
    isSyncing = false;
  }
}

// Multi-layer safe database saver (Local + Permanent DB + Backups + Automatic Cloud Sync)
function saveStudentsDatabase(students) {
  try {
    writeJson(STUDENTS_FILE, students);
    writeJson(PERMANENT_DB, students);
    const backupPath = path.join(BACKUPS_DIR, `backup_${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(students, null, 2), 'utf-8');
    
    // Asynchronously sync to GitHub cloud
    syncDatabaseToCloud(students).catch(() => {});
    return true;
  } catch (e) {
    console.error('Database save error:', e);
    return false;
  }
}

// Auto-recovery on startup (Checks local files, permanent DB, and GitHub Cloud)
async function initDatabase() {
  let current = readJson(STUDENTS_FILE, []);
  if (current.length === 0 && fs.existsSync(PERMANENT_DB)) {
    const backup = readJson(PERMANENT_DB, []);
    if (backup.length > 0) {
      console.log(`🔄 Database Auto-Recovery: ${backup.length} વિદ્યાર્થીઓનો ડેટા સફળતાપૂર્વક પુનઃસ્થાપિત થયો.`);
      writeJson(STUDENTS_FILE, backup);
      current = backup;
    }
  }

  // Also check GitHub cloud for latest data
  if (GITHUB_TOKEN && GITHUB_REPO) {
    try {
      const headers = {
        'Authorization': 'Bearer ' + GITHUB_TOKEN,
        'User-Agent': 'Satpada-Portal',
        'Accept': 'application/vnd.github.v3+json'
      };
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/data/students.json`, { headers });
      if (res.status === 200) {
        const data = await res.json();
        const cloudStudents = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
        if (Array.isArray(cloudStudents) && cloudStudents.length > 0) {
          if (cloudStudents.length >= current.length) {
            writeJson(STUDENTS_FILE, cloudStudents);
            writeJson(PERMANENT_DB, cloudStudents);
            console.log(`☁️ Cloud Sync on startup: ${cloudStudents.length} વિદ્યાર્થીઓ GitHub પરથી સિંક થયા.`);
          }
        }
      }
    } catch (e) {
      console.log('Cloud startup check skipped:', e.message);
    }
  }
}

// Helper to automatically reset and count roll numbers starting from 1 for each standard
function renumberRollsPerStandard(students) {
  if (!Array.isArray(students)) return;
  const stdGroups = {};
  students.forEach(s => {
    const std = String(s.standard || '').trim();
    if (!stdGroups[std]) stdGroups[std] = [];
    stdGroups[std].push(s);
  });

  Object.keys(stdGroups).forEach(std => {
    const group = stdGroups[std];
    // Sort students by existing roll number or GR
    group.sort((a, b) => {
      const rA = (a.rollNo !== null && a.rollNo !== undefined && !isNaN(a.rollNo)) ? Number(a.rollNo) : 99999;
      const rB = (b.rollNo !== null && b.rollNo !== undefined && !isNaN(b.rollNo)) ? Number(b.rollNo) : 99999;
      if (rA !== rB) return rA - rB;
      return String(a.grNumber || '').localeCompare(String(b.grNumber || ''));
    });
    // Assign roll numbers 1..N restarting for each standard
    group.forEach((s, idx) => {
      s.rollNo = idx + 1;
    });
  });
}

initDatabase();

// Grade calculation helper
function calculateGrade(percentage) {
  if (percentage >= 91) return 'A1';
  if (percentage >= 81) return 'A2';
  if (percentage >= 71) return 'B1';
  if (percentage >= 61) return 'B2';
  if (percentage >= 51) return 'C1';
  if (percentage >= 41) return 'C2';
  if (percentage >= 33) return 'D';
  return 'E (Needs Improvement)';
}

// ---------------- API ENDPOINTS ---------------- //

// 1. Get School Info
app.get('/api/school', (req, res) => {
  const school = readJson(SCHOOL_FILE, {});
  res.json({ success: true, school });
});

// 2. Update School Info (Admin)
app.post('/api/school', (req, res) => {
  const token = req.headers['authorization'];
  if (token !== 'Bearer admin-token-123') {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  const updatedSchool = req.body;
  if (writeJson(SCHOOL_FILE, updatedSchool)) {
    res.json({ success: true, message: 'School details updated successfully', school: updatedSchool });
  } else {
    res.status(500).json({ success: false, message: 'Failed to save school details' });
  }
});

// 3. Search Student Result (Strict Privacy - Roll number is optional!)
app.post('/api/result/search', (req, res) => {
  const { standard, rollNo, grNumber, examType } = req.body;

  if (!standard || !grNumber) {
    return res.status(400).json({
      success: false,
      message: 'ધોરણ (Class) અને જી.આર. નંબર (GR No) દાખલ કરવા ફરજિયાત છે.'
    });
  }

  const students = readJson(STUDENTS_FILE, []);

  // Strict comparison
  const matchedStudent = students.find(s => {
    const stdMatch = String(s.standard).trim() === String(standard).trim();
    const grMatch = String(s.grNumber).trim().toLowerCase() === String(grNumber).trim().toLowerCase();
    
    // Roll number is optional: if provided, verify it; if left empty, stdMatch and grMatch are sufficient
    let rollMatch = true;
    if (rollNo !== undefined && rollNo !== null && String(rollNo).trim() !== '') {
      rollMatch = parseInt(s.rollNo, 10) === parseInt(rollNo, 10);
    }

    // Optional exam filter
    if (examType && examType !== 'all') {
      const examMatch = !s.examType || s.examType.toLowerCase() === examType.toLowerCase();
      return stdMatch && grMatch && rollMatch && examMatch;
    }
    return stdMatch && grMatch && rollMatch;
  });

  if (!matchedStudent) {
    return res.status(404).json({
      success: false,
      message: 'દાખલ કરેલ વિગતો મુજબ કોઈ પરિણામ મળ્યું નથી. કૃપા કરીને ધોરણ અને જી.આર. નંબર ફરીથી ચકાસો.'
    });
  }

  // Returns ONLY the single matched student record
  const school = readJson(SCHOOL_FILE, {});
  res.json({
    success: true,
    school,
    student: matchedStudent
  });
});

// 4. Admin Login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const adminData = readJson(ADMIN_FILE, { username: 'Ashokbhai', password: 'Ashokbhai@123' });

  if (username === adminData.username && password === adminData.password) {
    const sessionToken = 'satpada-token-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
    activeAdminTokens.add(sessionToken);

    adminData.lastLogin = new Date().toISOString();
    writeJson(ADMIN_FILE, adminData);

    return res.json({
      success: true,
      token: sessionToken,
      user: { username: adminData.username, role: 'શાળા સંચાલક / આચાર્યશ્રી (Ashokbhai)' }
    });
  }
  return res.status(401).json({
    success: false,
    message: 'અમાન્ય યૂઝરનેમ અથવા પાસવર્ડ! માત્ર અશોકભાઈ (Ashokbhai) જ લૉગિન કરી શકે છે.'
  });
});

// Middleware for Admin Auth
function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ success: false, message: 'સુરક્ષા એરર: માત્ર અધિકૃત એડમિન જ ડેટા બદલી શકે છે.' });
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (activeAdminTokens.has(token)) {
    return next();
  }
  return res.status(401).json({ success: false, message: 'સુરક્ષા એરર: તમારું સત્ર સમાપ્ત થઈ ગયું છે. ફરી લોગિન કરો.' });
}

// 4.1 Admin Change Password
app.post('/api/admin/change-password', requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const adminData = readJson(ADMIN_FILE, { username: 'Ashokbhai', password: 'Ashokbhai@123' });

  if (currentPassword !== adminData.password) {
    return res.status(400).json({ success: false, message: 'હાલનો પાસવર્ડ ખોટો છે!' });
  }

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'નવો પાસવર્ડ ઓછામાં ઓછા ૬ અક્ષરનો હોવો જોઈએ!' });
  }

  adminData.password = newPassword;
  writeJson(ADMIN_FILE, adminData);

  res.json({ success: true, message: 'પાસવર્ડ સફળતાપૂર્વક બદલાઈ ગયો છે!' });
});

// 5. Get All Students (Admin Only)
app.get('/api/admin/students', requireAdmin, (req, res) => {
  const students = readJson(STUDENTS_FILE, []);
  res.json({ success: true, count: students.length, students });
});

// 6. Add Single Student (Admin Only)
app.post('/api/admin/students', requireAdmin, (req, res) => {
  const students = readJson(STUDENTS_FILE, []);
  const newStudent = req.body;

  if (!newStudent.grNumber || !newStudent.standard || !newStudent.studentName) {
    return res.status(400).json({ success: false, message: 'જી.આર. નંબર, ધોરણ અને વિદ્યાર્થીનું નામ દાખલ કરવા ફરજિયાત છે.' });
  }

  // Roll number is optional
  newStudent.rollNo = (newStudent.rollNo !== undefined && newStudent.rollNo !== null && String(newStudent.rollNo).trim() !== '') ? parseInt(newStudent.rollNo, 10) : null;

  // Check GR number uniqueness in the school
  const existing = students.find(s => s.grNumber === String(newStudent.grNumber).trim());
  if (existing) {
    return res.status(400).json({ success: false, message: `GR Number ${newStudent.grNumber} is already registered.` });
  }

  newStudent.id = 'std-' + (newStudent.grNumber || Date.now());
  
  // Calculate marks total if subjects present
  if (Array.isArray(newStudent.subjects) && newStudent.subjects.length > 0) {
    let totalMax = 0;
    let totalObt = 0;
    newStudent.subjects.forEach(sub => {
      totalMax += Number(sub.maxMarks) || 0;
      totalObt += Number(sub.obtainedMarks) || 0;
      const subPct = sub.maxMarks ? (sub.obtainedMarks / sub.maxMarks) * 100 : 0;
      sub.grade = calculateGrade(subPct);
    });
    newStudent.totalMaxMarks = totalMax;
    newStudent.totalObtainedMarks = totalObt;
    newStudent.percentage = totalMax > 0 ? Number(((totalObt / totalMax) * 100).toFixed(2)) : 0;
    newStudent.overallGrade = calculateGrade(newStudent.percentage);
    newStudent.resultStatus = newStudent.percentage >= 33 ? 'પાસ (Passed)' : 'નાપાસ (Failed)';
  }

  if (!newStudent.rollNo) {
    const stdStudents = students.filter(s => String(s.standard).trim() === String(newStudent.standard).trim());
    newStudent.rollNo = stdStudents.length + 1;
  }

  students.push(newStudent);
  saveStudentsDatabase(students);

  res.json({ success: true, message: 'Student result added successfully', student: newStudent });
});

// 7. Update Student (Admin Only)
app.put('/api/admin/students/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const students = readJson(STUDENTS_FILE, []);
  const index = students.findIndex(s => s.id === id);

  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Student record not found' });
  }

  const updatedData = { ...students[index], ...req.body, id };

  // Recalculate marks
  if (Array.isArray(updatedData.subjects) && updatedData.subjects.length > 0) {
    let totalMax = 0;
    let totalObt = 0;
    updatedData.subjects.forEach(sub => {
      totalMax += Number(sub.maxMarks) || 0;
      totalObt += Number(sub.obtainedMarks) || 0;
      const subPct = sub.maxMarks ? (sub.obtainedMarks / sub.maxMarks) * 100 : 0;
      sub.grade = calculateGrade(subPct);
    });
    updatedData.totalMaxMarks = totalMax;
    updatedData.totalObtainedMarks = totalObt;
    updatedData.percentage = totalMax > 0 ? Number(((totalObt / totalMax) * 100).toFixed(2)) : 0;
    updatedData.overallGrade = calculateGrade(updatedData.percentage);
    updatedData.resultStatus = updatedData.percentage >= 33 ? 'પાસ (Passed)' : 'નાપાસ (Failed)';
  }

  students[index] = updatedData;
  saveStudentsDatabase(students);

  res.json({ success: true, message: 'Student record updated', student: updatedData });
});

// 8. Delete Student (Admin Only)
app.delete('/api/admin/students/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  let students = readJson(STUDENTS_FILE, []);
  const initialLen = students.length;
  students = students.filter(s => s.id !== id);

  if (students.length === initialLen) {
    return res.status(404).json({ success: false, message: 'Student not found' });
  }

  saveStudentsDatabase(students);
  res.json({ success: true, message: 'Student record deleted successfully' });
});

// 9. Download Sample CSV Template
app.get('/api/admin/sample-csv', (req, res) => {
  const csvHeaders = 'grNumber,rollNo,standard,division,studentName,studentNameGu,fatherName,motherName,dob,gujarati,mathematics,science,socialScience,english,hindi,sanskrit,drawing,pe,attendancePresent,attendanceTotal,teacherRemarks\n' +
    '101,1,8,A,Rahul Patel,રાહુલ પટેલ,Kishorbhai,Minaben,2011-04-12,85,92,88,84,80,86,90,45,48,210,220,ઉત્કૃષ્ટ પ્રગતિ\n' +
    '102,,8,A,Priya Shah,પ્રિયા શાહ,Dipakkumar,Rekhaben,2011-08-25,90,95,92,89,88,85,94,48,46,215,220,ખૂબ જ હોંશિયાર વિદ્યાર્થી';

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="satpada_students_template.csv"');
  res.send('\uFEFF' + csvHeaders);
});

// 9.1 Download Sample Excel (.xlsx) Template
app.get('/api/admin/sample-excel', (req, res) => {
  const sampleData = [
    {
      "GR Number": "101",
      "Roll No": 1,
      "Standard": "8",
      "Division": "A",
      "Student Name (English)": "Rahul Patel",
      "વિદ્યાર્થીનું નામ (ગુજરાતી)": "રાહુલ પટેલ",
      "પિતાનું નામ": "કિશોરભાઈ",
      "માતાનું નામ": "મીનાબેન",
      "જન્મ તારીખ": "2011-04-12",
      "ગુજરાતી": 85,
      "ગણિત": 92,
      "વિજ્ઞાન": 88,
      "સામાજિક વિજ્ઞાન": 84,
      "અંગ્રેજી": 80,
      "હિન્દી": 86,
      "સંસ્કૃત": 90,
      "ચિત્રકામ": 45,
      "શારીરિક શિક્ષણ": 48,
      "હાજર દિવસ": 210,
      "કુલ દિવસ": 220,
      "શિક્ષક અભિપ્રાય": "ઉત્કૃષ્ટ પરિણામ. અભિનંદન!"
    },
    {
      "GR Number": "102",
      "Roll No": "",
      "Standard": "8",
      "Division": "A",
      "Student Name (English)": "Priya Shah",
      "વિદ્યાર્થીનું નામ (ગુજરાતી)": "પ્રિયા શાહ",
      "પિતાનું નામ": "દીપકકુમાર",
      "માતાનું નામ": "રેખાબેન",
      "જન્મ તારીખ": "2011-08-25",
      "ગુજરાતી": 90,
      "ગણિત": 95,
      "વિજ્ઞાન": 92,
      "સામાજિક વિજ્ઞાન": 89,
      "અંગ્રેજી": 88,
      "હિન્દી": 85,
      "સંસ્કૃત": 94,
      "ચિત્રકામ": 48,
      "શારીરિક શિક્ષણ": 46,
      "હાજર દિવસ": 215,
      "કુલ દિવસ": 220,
      "શિક્ષક અભિપ્રાય": "વર્ગમાં પ્રથમ ક્રમાંક મેળવ્યો છે."
    }
  ];

  const ws = XLSX.utils.json_to_sheet(sampleData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Students");

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="satpada_students_template.xlsx"');
  res.send(buffer);
});

// 9.2 Export All Current Students to CSV/Excel
app.get('/api/admin/export-csv', requireAdmin, (req, res) => {
  const students = readJson(STUDENTS_FILE, []);
  let csv = '\uFEFFgrNumber,rollNo,standard,division,studentName,studentNameGu,fatherName,motherName,dob,percentage,overallGrade,resultStatus\n';
  students.forEach(s => {
    csv += `"${s.grNumber}","${s.rollNo !== null ? s.rollNo : ''}","${s.standard}","${s.division || 'A'}","${s.studentName || ''}","${s.studentNameGu || ''}","${s.fatherName || ''}","${s.motherName || ''}","${s.dob || ''}","${s.percentage || ''}","${s.overallGrade || ''}","${s.resultStatus || ''}"\n`;
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="satpada_students_data.csv"');
  res.send(csv);
});

// Multer upload config for Excel and CSV
const upload = multer({ dest: path.join(__dirname, 'uploads') });

// Helper to extract column value case-insensitively
function getColValue(row, aliases) {
  const rowKeys = Object.keys(row);
  for (const alias of aliases) {
    const cleanAlias = alias.toLowerCase().replace(/[\s_\-\.]/g, '');
    const foundKey = rowKeys.find(k => k.trim().toLowerCase().replace(/[\s_\-\.]/g, '') === cleanAlias);
    if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null) {
      return String(row[foundKey]).trim();
    }
  }
  return '';
}

// 10. Universal Bulk Excel / CSV Upload Handler (Supports Multi-Sheet, Row-Offset Titles, and Missing Marks)
const handleExcelUpload = (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ success: false, message: 'કોઈ Excel કે CSV ફાઈલ પસંદ કરેલ નથી.' });
  }

  try {
    const workbook = XLSX.readFile(file.path, { cellDates: true });
    try { fs.unlinkSync(file.path); } catch (e) {}

    const students = readJson(STUDENTS_FILE, []);
    let updatedCount = 0;
    let addedCount = 0;

    // Helper to find column index by matching clean keywords
    const findColIndex = (colMap, keywords) => {
      for (const [idx, colName] of Object.entries(colMap)) {
        for (const kw of keywords) {
          if (colName.includes(kw)) return parseInt(idx, 10);
        }
      }
      return -1;
    };

    // Process all sheets that contain student records
    for (const sheetName of workbook.SheetNames) {
      // Skip non-student summary sheets if any
      const cleanSheet = sheetName.trim().toUpperCase();
      if (['CATEGARI', 'CATEGORY', 'SUMMARY', 'Sheet1'].includes(cleanSheet)) continue;

      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
      if (!data || data.length === 0) continue;

      // Find the actual header row index dynamically (scans first 15 rows)
      let headerRowIdx = -1;
      const colMap = {};

      for (let i = 0; i < Math.min(data.length, 15); i++) {
        const row = data[i];
        if (!Array.isArray(row)) continue;
        const rowStr = row.map(c => String(c || '').trim().toLowerCase().replace(/[\s_\-\.]/g, '')).join(' ');
        if (
          rowStr.includes('જીઆર') || 
          rowStr.includes('gr') || 
          rowStr.includes('જનરલ') || 
          (rowStr.includes('વિદ્યાર્થી') && (rowStr.includes('ધોરણ') || rowStr.includes('રોલ') || rowStr.includes('ક્રમ')))
        ) {
          headerRowIdx = i;
          row.forEach((cell, colIdx) => {
            const clean = String(cell || '').trim().toLowerCase().replace(/[\s_\-\.]/g, '');
            if (clean) colMap[colIdx] = clean;
          });
          break;
        }
      }

      if (headerRowIdx === -1) {
        continue;
      }

      // Column mapping
      const grIdx = findColIndex(colMap, ['જીઆરનંબર', 'જીઆરનં', 'જીઆર', 'grnumber', 'grno', 'gr', 'જનરલરજીસ્ટર', 'જનરલ', 'regno', 'id']);
      const stdIdx = findColIndex(colMap, ['ધોરણ', 'standard', 'std', 'વર્ગધોરણ', 'ધોરણવર્ગ', 'class']);
      const rollIdx = findColIndex(colMap, ['રોલનંબર', 'રોલનં', 'રોલ', 'rollno', 'roll', 'ક્રમ', 'અનુક્રમ', 'srno', 'sr']);
      const nameIdx = findColIndex(colMap, ['વિદ્યાર્થીનુંનામ', 'વિદ્યાર્થીનામ', 'નામવિદ્યાર્થી', 'studentname', 'વિદ્યાર્થી', 'નામ', 'name']);
      const nameGuIdx = findColIndex(colMap, ['નામગુજરાતી', 'studentnamegu', 'namegu']);
      const fatherIdx = findColIndex(colMap, ['પિતાનુંનામ', 'પિતાનામ', 'વાલીનુંનામ', 'પિતા', 'fathername', 'father']);
      const motherIdx = findColIndex(colMap, ['માતાનુંનામ', 'માતાનામ', 'માતા', 'mothername', 'mother']);
      const dobIdx = findColIndex(colMap, ['જન્મતારીખ', 'જન્મ', 'તારીખ', 'dob', 'birthdate', 'dateofbirth']);
      const genderIdx = findColIndex(colMap, ['જેંડર', 'જાતિ', 'gender', 'sex']);
      const divIdx = findColIndex(colMap, ['શાખા', 'વર્ગખંડ', 'વર્ગ', 'division', 'div', 'sec']);

      // Subject marks
      const gujIdx = findColIndex(colMap, ['ગુજરાતી', 'gujarati', 'guj']);
      const mathIdx = findColIndex(colMap, ['ગણિત', 'mathematics', 'maths', 'math']);
      const sciIdx = findColIndex(colMap, ['વિજ્ઞાન', 'પર્યાવરણ', 'science', 'evs', 'sci']);
      const ssIdx = findColIndex(colMap, ['સામાજિકવિજ્ઞાન', 'સામાજિક', 'socialscience', 'social', 'ss']);
      const engIdx = findColIndex(colMap, ['અંગ્રેજી', 'english', 'eng']);
      const hinIdx = findColIndex(colMap, ['હિન્દી', 'hindi', 'hin']);
      const sktIdx = findColIndex(colMap, ['સંસ્કૃત', 'sanskrit', 'skt']);
      const artIdx = findColIndex(colMap, ['ચિત્રકામ', 'ચિત્ર', 'drawing', 'art']);
      const peIdx = findColIndex(colMap, ['શારીરિકશિક્ષણ', 'શારીરિક', 'sports', 'pe']);

      const attPresentIdx = findColIndex(colMap, ['હાજરદિવસ', 'હાજર', 'present', 'attendancepresent']);
      const attTotalIdx = findColIndex(colMap, ['કુલદિવસ', 'totaldays', 'attendancetotal']);
      const remarksIdx = findColIndex(colMap, ['શિક્ષકઅભિપ્રાય', 'અભિપ્રાય', 'remarks', 'teacherremarks']);

      // Parse data rows
      for (let r = headerRowIdx + 1; r < data.length; r++) {
        const row = data[r];
        if (!row || row.length === 0) continue;

        // Stop processing if this table ended and a secondary summary table began
        const firstCell = String(row[0] || '').trim();
        if (firstCell.includes('શિષ્યવૃતિ') || firstCell.includes('જ્ઞાતિ') || firstCell.includes('કુલ સંખ્યા') || firstCell.includes('TOTAL STUDENT')) {
          break;
        }

        const rawGr = grIdx >= 0 ? String(row[grIdx] || '').trim() : '';
        if (!rawGr || rawGr.toLowerCase() === 'gr' || rawGr.includes('જી.આર') || rawGr.toLowerCase() === 'null') {
          continue;
        }

        // Standard detection: from std column, sheet name, or default
        const rawStd = stdIdx >= 0 ? String(row[stdIdx] || '').trim() : '';
        let std = '';
        if (rawStd) {
          const m = rawStd.match(/\d+/);
          std = m ? m[0] : rawStd;
        }
        if (!std) {
          const sm = sheetName.match(/\d+/);
          if (sm) std = sm[0];
        }
        if (!std) std = '8';

        // Roll number (optional)
        const rawRoll = rollIdx >= 0 ? String(row[rollIdx] || '').trim() : '';
        const rollNo = rawRoll && !isNaN(parseInt(rawRoll, 10)) ? parseInt(rawRoll, 10) : null;

        // Student name
        const rawName = nameIdx >= 0 ? String(row[nameIdx] || '').trim().replace(/\s+/g, ' ') : '';
        const rawNameGu = nameGuIdx >= 0 ? String(row[nameGuIdx] || '').trim().replace(/\s+/g, ' ') : '';
        const studentName = rawName || rawNameGu || 'Student';
        const studentNameGu = rawNameGu || rawName || 'વિદ્યાર્થી';

        const fatherName = fatherIdx >= 0 ? String(row[fatherIdx] || '').trim() : '';
        const motherName = motherIdx >= 0 ? String(row[motherIdx] || '').trim() : '';
        const dob = dobIdx >= 0 ? String(row[dobIdx] || '').trim() : '';
        const gender = genderIdx >= 0 ? String(row[genderIdx] || '').trim() : '';
        const division = divIdx >= 0 ? String(row[divIdx] || '').trim() || 'A' : 'A';

        // Check if marks are present
        const gujVal = gujIdx >= 0 ? String(row[gujIdx] || '').trim() : '';
        const mathVal = mathIdx >= 0 ? String(row[mathIdx] || '').trim() : '';
        const sciVal = sciIdx >= 0 ? String(row[sciIdx] || '').trim() : '';
        const ssVal = ssIdx >= 0 ? String(row[ssIdx] || '').trim() : '';
        const engVal = engIdx >= 0 ? String(row[engIdx] || '').trim() : '';
        const hinVal = hinIdx >= 0 ? String(row[hinIdx] || '').trim() : '';
        const sktVal = sktIdx >= 0 ? String(row[sktIdx] || '').trim() : '';
        const artVal = artIdx >= 0 ? String(row[artIdx] || '').trim() : '';
        const peVal = peIdx >= 0 ? String(row[peIdx] || '').trim() : '';

        const subjects = [];
        if (gujVal !== '') subjects.push({ name: "Gujarati (ગુજરાતી - પ્રથમ ભાષા)", code: "GUJ", maxMarks: 100, obtainedMarks: Number(gujVal) || 0 });
        if (mathVal !== '') subjects.push({ name: "Mathematics (ગણિત)", code: "MATH", maxMarks: 100, obtainedMarks: Number(mathVal) || 0 });
        if (sciVal !== '') {
          const isEvs = Number(std) <= 5;
          subjects.push({ name: isEvs ? "Environment (પર્યાવરણ)" : "Science & Tech (વિજ્ઞાન અને ટેકનોલોજી)", code: isEvs ? "EVS" : "SCI", maxMarks: 100, obtainedMarks: Number(sciVal) || 0 });
        }
        if (ssVal !== '') subjects.push({ name: "Social Science (સામાજિક વિજ્ઞાન)", code: "SS", maxMarks: 100, obtainedMarks: Number(ssVal) || 0 });
        if (engVal !== '') subjects.push({ name: "English (અંગ્રેજી)", code: "ENG", maxMarks: 100, obtainedMarks: Number(engVal) || 0 });
        if (hinVal !== '') subjects.push({ name: "Hindi (હિન્દી)", code: "HIN", maxMarks: 100, obtainedMarks: Number(hinVal) || 0 });
        if (sktVal !== '') subjects.push({ name: "Sanskrit (સંસ્કૃત)", code: "SKT", maxMarks: 100, obtainedMarks: Number(sktVal) || 0 });
        if (artVal !== '') subjects.push({ name: "Drawing (ચિત્રકામ)", code: "ART", maxMarks: 50, obtainedMarks: Number(artVal) || 0 });
        if (peVal !== '') subjects.push({ name: "Physical Education (શારીરિક શિક્ષણ)", code: "PE", maxMarks: 50, obtainedMarks: Number(peVal) || 0 });

        let totalMax = 0;
        let totalObt = 0;
        subjects.forEach(sub => {
          totalMax += sub.maxMarks;
          totalObt += sub.obtainedMarks;
          sub.grade = calculateGrade((sub.obtainedMarks / sub.maxMarks) * 100);
        });

        const hasMarks = subjects.length > 0;
        const pct = hasMarks && totalMax > 0 ? Number(((totalObt / totalMax) * 100).toFixed(2)) : null;

        const attPresent = attPresentIdx >= 0 ? Number(row[attPresentIdx]) || 205 : 205;
        const attTotal = attTotalIdx >= 0 ? Number(row[attTotalIdx]) || 220 : 220;
        const attPct = attTotal > 0 ? Number(((attPresent / attTotal) * 100).toFixed(2)) : 93.18;
        const remarks = (remarksIdx >= 0 && row[remarksIdx]) ? String(row[remarksIdx]).trim() : (hasMarks ? 'પ્રગતિશીલ પરિણામ. અભિનંદન!' : 'હજુ પરિણામ અપલોડ થયેલ નથી');

        const studentObj = {
          id: 'std-' + rawGr + (rollNo !== null ? '-' + rollNo : ''),
          grNumber: String(rawGr),
          rollNo: rollNo,
          standard: String(std),
          division,
          studentName,
          studentNameGu,
          fatherName,
          motherName,
          dob,
          gender,
          examType: 'Annual',
          hasMarks,
          attendance: { totalDays: attTotal, presentDays: attPresent, percentage: attPct },
          subjects,
          personalityTraits: {
            cleanliness: "ઉત્તમ (Excellent)",
            discipline: "ઉત્તમ (Excellent)",
            curiosity: "ખૂબ સારું (Very Good)",
            sportsmanship: "ઉત્તમ (Excellent)"
          },
          totalMaxMarks: totalMax,
          totalObtainedMarks: totalObt,
          percentage: pct,
          overallGrade: hasMarks ? calculateGrade(pct) : '-',
          resultStatus: hasMarks ? (pct >= 33 ? 'પાસ (Passed)' : 'નાપાસ (Failed)') : 'હજુ પરિણામ અપલોડ થયેલ નથી (Result Not Uploaded Yet)',
          rank: null,
          teacherRemarks: remarks
        };

        // Find existing student by GR and Standard (and roll if duplicate GR exists)
        const existingIdx = students.findIndex(s => {
          const grMatch = String(s.grNumber).trim().toLowerCase() === String(studentObj.grNumber).trim().toLowerCase();
          const stdMatch = String(s.standard).trim() === String(studentObj.standard).trim();
          if (grMatch && stdMatch && studentObj.rollNo !== null && s.rollNo !== null) {
            return s.rollNo === studentObj.rollNo;
          }
          return grMatch && stdMatch;
        });

        if (existingIdx >= 0) {
          // If existing student had marks and new upload doesn't, keep existing marks
          if (!studentObj.hasMarks && students[existingIdx].hasMarks) {
            delete studentObj.subjects;
            delete studentObj.hasMarks;
            delete studentObj.totalMaxMarks;
            delete studentObj.totalObtainedMarks;
            delete studentObj.percentage;
            delete studentObj.overallGrade;
            delete studentObj.resultStatus;
          }
          // Preserve existing student profile details if new upload has blank/default
          if (students[existingIdx].studentName && (studentObj.studentName === 'Student' || !studentObj.studentName)) {
            studentObj.studentName = students[existingIdx].studentName;
          }
          if (students[existingIdx].studentNameGu && (studentObj.studentNameGu === 'વિદ્યાર્થી' || !studentObj.studentNameGu)) {
            studentObj.studentNameGu = students[existingIdx].studentNameGu;
          }
          if (students[existingIdx].dob && !studentObj.dob) {
            studentObj.dob = students[existingIdx].dob;
          }
          if (students[existingIdx].gender && !studentObj.gender) {
            studentObj.gender = students[existingIdx].gender;
          }
          if (students[existingIdx].fatherName && !studentObj.fatherName) {
            studentObj.fatherName = students[existingIdx].fatherName;
          }
          if (students[existingIdx].motherName && !studentObj.motherName) {
            studentObj.motherName = students[existingIdx].motherName;
          }
          if (students[existingIdx].rollNo !== null && studentObj.rollNo === null) {
            studentObj.rollNo = students[existingIdx].rollNo;
          }

          students[existingIdx] = { ...students[existingIdx], ...studentObj };
          updatedCount++;
        } else {
          students.push(studentObj);
          addedCount++;
        }
      }
    }

    if (addedCount === 0 && updatedCount === 0) {
      return res.status(400).json({
        success: false,
        message: 'Excel ફાઈલમાંથી કોઈ વિદ્યાર્થીનો રેકોર્ડ મળ્યો નથી. કૃપા કરીને ફાઈલમાં જી.આર. નંબર અને ધોરણ ચકાસો.'
      });
    }

    // Automatically recount and restart roll numbers from 1 for each standard
    renumberRollsPerStandard(students);

    saveStudentsDatabase(students);
    return res.json({
      success: true,
      message: `Excel ફાઈલ સફળતાપૂર્વક અપલોડ થઈ ગઈ! કુલ ${addedCount} નવા વિદ્યાર્થીઓ ઉમેરાયા અને ${updatedCount} વિદ્યાર્થીઓનો ડેટા અપડેટ થયો. (કુલ વિદ્યાર્થીઓ: ${students.length})`
    });
  } catch (err) {
    console.error('Excel parse error:', err);
    return res.status(500).json({ success: false, message: 'Excel ફાઈલ પ્રોસેસ કરવામાં એરર: ' + err.message });
  }
};

app.post('/api/admin/upload-csv', requireAdmin, upload.single('excelFile'), handleExcelUpload);
app.post('/api/admin/upload-excel', requireAdmin, upload.single('excelFile'), handleExcelUpload);

// Create uploads dir if doesn't exist
if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads'));
}

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server with automatic port-fallback if port is in use
const DEFAULT_PORT = Number(process.env.PORT) || 3000;

function startServer(port) {
  const server = app.listen(port, () => {
    console.log('\n=============================================================');
    console.log(`🏫 શ્રી સાતપડા પ્રાથમિક શાળા - પરિણામ પોર્ટલ સફળતાપૂર્વક શરૂ થયું!`);
    console.log(`🌐 બ્રાઉઝરમાં ખોલો: http://localhost:${port}`);
    console.log('=============================================================\n');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️ પોર્ટ ${port} પહેલેથી વપરાશમાં છે. પોર્ટ ${port + 1} પર ચાલુ કરી રહ્યા છીએ...`);
      startServer(port + 1);
    } else {
      console.error('સર્વર શરૂ કરવામાં એરર:', err);
    }
  });
}

startServer(DEFAULT_PORT);

