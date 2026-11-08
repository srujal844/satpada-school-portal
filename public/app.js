// School Result Portal JavaScript Logic

let currentSchool = null;
let currentStudent = null;
let adminAuthToken = localStorage.getItem('school_admin_token') || null;
let qrCodeInstance = null;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  fetchSchoolInfo();
  setupEventListeners();
  checkUrlParams();
});

// 1. Fetch School Info
async function fetchSchoolInfo() {
  try {
    const res = await fetch('/api/school');
    const data = await res.json();
    if (data.success && data.school) {
      currentSchool = data.school;
      updateSchoolUi(data.school);
    }
  } catch (err) {
    console.error('Failed to load school info:', err);
  }
}

function updateSchoolUi(school) {
  if (school.schoolNameGu) {
    document.getElementById('headerSchoolNameGu').textContent = school.schoolNameGu;
    document.getElementById('cardSchoolNameGu').textContent = school.schoolNameGu;
  }
  if (school.schoolNameEn) {
    document.getElementById('headerSchoolNameEn').textContent = school.schoolNameEn;
    document.getElementById('cardSchoolNameEn').textContent = school.schoolNameEn;
  }
  if (school.udiseCode) {
    document.getElementById('headerUdise').textContent = school.udiseCode;
    document.getElementById('cardUdise').textContent = school.udiseCode;
  }
  if (school.academicYear) {
    document.getElementById('headerAcademicYear').textContent = school.academicYear;
    document.getElementById('cardAcademicYear').textContent = school.academicYear;
  }
  if (school.notice) {
    document.getElementById('schoolNotice').textContent = school.notice;
  }
  if (school.taluka || school.district || school.village) {
    const loc = [school.village, school.taluka ? `તા. ${school.taluka}` : '', school.district ? `જી. ${school.district}` : ''].filter(Boolean).join(', ');
    document.getElementById('cardSchoolAddress').textContent = `${loc} | U-DISE કોડ: ${school.udiseCode || ''}`;
  }
  if (school.principalName) {
    document.getElementById('cardPrincipalSign').textContent = school.principalName;
  }
}

// 2. Setup Event Listeners
function setupEventListeners() {
  // Search Form Submit
  const searchForm = document.getElementById('resultSearchForm');
  searchForm.addEventListener('submit', handleSearchSubmit);

  // Demo auto-fill (if present)
  const demoBtn = document.getElementById('fillDemoBtn');
  if (demoBtn) {
    demoBtn.addEventListener('click', () => {
      document.getElementById('inputStandard').value = '4';
      document.getElementById('inputRollNo').value = '5';
      document.getElementById('inputGrNumber').value = '2362';
      hideError();
    });
  }

  // Back to Search
  document.getElementById('backToSearchBtn').addEventListener('click', () => {
    document.getElementById('resultSection').classList.add('hidden');
    document.getElementById('searchSection').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Print Marksheet
  document.getElementById('printMarksheetBtn').addEventListener('click', () => {
    window.print();
  });

  // Share WhatsApp
  document.getElementById('shareWhatsappBtn').addEventListener('click', shareOnWhatsApp);

  // Admin Modal toggles
  document.getElementById('adminLoginBtn').addEventListener('click', openAdminModal);
  document.getElementById('closeAdminModalBtn').addEventListener('click', closeAdminModal);

  // Admin Login form
  document.getElementById('adminLoginForm').addEventListener('submit', handleAdminLogin);
  document.getElementById('adminLogoutBtn').addEventListener('click', handleAdminLogout);

  // Admin Tabs
  document.getElementById('tabStudentsBtn').addEventListener('click', () => switchAdminTab('students'));
  document.getElementById('tabAddStudentBtn').addEventListener('click', () => switchAdminTab('add'));
  document.getElementById('tabBulkUploadBtn').addEventListener('click', () => switchAdminTab('bulk'));
  document.getElementById('tabPasswordBtn').addEventListener('click', () => switchAdminTab('password'));

  // Admin Add Student Form
  document.getElementById('addStudentForm').addEventListener('submit', handleAddStudentSubmit);

  // Admin Excel/CSV Upload Form
  const excelForm = document.getElementById('excelUploadForm') || document.getElementById('csvUploadForm');
  if (excelForm) {
    excelForm.addEventListener('submit', handleExcelUploadSubmit);
  }

  // Admin Change Password Form
  document.getElementById('changePasswordForm').addEventListener('submit', handlePasswordChangeSubmit);

  // Admin Export CSV
  document.getElementById('adminExportCsvBtn').addEventListener('click', handleAdminExportCsv);

  // Admin Search filter
  document.getElementById('adminSearchInput').addEventListener('input', handleAdminStudentFilter);
}

// 3. Search Student Result (Roll No is optional)
async function handleSearchSubmit(e) {
  e.preventDefault();
  hideError();

  const standard = document.getElementById('inputStandard').value.trim();
  const rollNo = document.getElementById('inputRollNo').value.trim();
  const grNumber = document.getElementById('inputGrNumber').value.trim();
  const examType = document.getElementById('inputExamType').value;

  if (!standard || !grNumber) {
    showError('કૃપા કરીને ધોરણ અને જી.આર. નંબર દાખલ કરો.');
    return;
  }

  setSearchLoading(true);

  try {
    const res = await fetch('/api/result/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ standard, rollNo, grNumber, examType })
    });

    const data = await res.json();

    if (data.success && data.student) {
      currentStudent = data.student;
      renderReportCard(data.student, data.school);
      document.getElementById('searchSection').classList.add('hidden');
      document.getElementById('resultSection').classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      showError(data.message || 'કોઈ પરિણામ મળ્યું નથી. કૃપા કરીને આપેલી વિગતો તપાસો.');
    }
  } catch (err) {
    console.error('Search request error:', err);
    showError('સર્વર સાથે સંપર્ક કરવામાં ભૂલ થઈ. કૃપા કરીને ફરીથી પ્રયત્ન કરો.');
  } finally {
    setSearchLoading(false);
  }
}

function setSearchLoading(isLoading) {
  const btn = document.getElementById('submitSearchBtn');
  const btnText = document.getElementById('btnText');
  const btnIcon = document.getElementById('btnIcon');
  const btnSpinner = document.getElementById('btnSpinner');

  if (isLoading) {
    btn.disabled = true;
    btnText.textContent = 'પરિણામ શોધાઈ રહ્યું છે... (Checking...)';
    btnIcon.classList.add('hidden');
    btnSpinner.classList.remove('hidden');
  } else {
    btn.disabled = false;
    btnText.textContent = 'પરિણામ જુઓ (Show Result)';
    btnIcon.classList.remove('hidden');
    btnSpinner.classList.add('hidden');
  }
}

function showError(msg) {
  const alert = document.getElementById('searchErrorAlert');
  const text = document.getElementById('searchErrorMessage');
  text.textContent = msg;
  alert.classList.remove('hidden');
}

function hideError() {
  document.getElementById('searchErrorAlert').classList.add('hidden');
}

// 4. Render Official Report Card (Supports Result Pending state)
function renderReportCard(student, school) {
  const isPending = (student.hasMarks === false) || (!student.subjects || student.subjects.length === 0);
  const pendingCard = document.getElementById('resultPendingCard');
  const marksheetCard = document.getElementById('printableReportCard');
  const printBtn = document.getElementById('printMarksheetBtn');
  const shareBtn = document.getElementById('shareWhatsappBtn');

  if (isPending) {
    if (pendingCard) {
      pendingCard.classList.remove('hidden');
      document.getElementById('pendingStudentName').textContent = student.studentNameGu || student.studentName || 'વિદ્યાર્થી';
      document.getElementById('pendingStandard').textContent = `ધોરણ ${student.standard} (${student.division || 'A'})`;
      document.getElementById('pendingGrNumber').textContent = student.grNumber;
      document.getElementById('pendingRollNo').textContent = (student.rollNo !== null && student.rollNo !== undefined && student.rollNo !== '') ? student.rollNo : '-';
    }
    if (marksheetCard) marksheetCard.classList.add('hidden');
    if (printBtn) printBtn.classList.add('hidden');
    if (shareBtn) shareBtn.classList.add('hidden');
    return;
  }

  // If marks are available, show official marksheet
  if (pendingCard) pendingCard.classList.add('hidden');
  if (marksheetCard) marksheetCard.classList.remove('hidden');
  if (printBtn) printBtn.classList.remove('hidden');
  if (shareBtn) shareBtn.classList.remove('hidden');

  // Student Personal Info
  document.getElementById('cardStudentNameGu').textContent = student.studentNameGu || student.studentName;
  document.getElementById('cardStudentNameEn').textContent = student.studentName ? `(${student.studentName})` : '';
  document.getElementById('cardFatherName').textContent = student.fatherName || '-';
  document.getElementById('cardMotherName').textContent = student.motherName || '-';
  document.getElementById('cardStandard').textContent = `ધોરણ ${student.standard}`;
  document.getElementById('cardDivision').textContent = student.division || 'A';
  document.getElementById('cardRollNo').textContent = (student.rollNo !== null && student.rollNo !== undefined && student.rollNo !== '') ? student.rollNo : '-';
  document.getElementById('cardGrNumber').textContent = student.grNumber;
  document.getElementById('cardDob').textContent = student.dob || '-';

  // Attendance
  if (student.attendance) {
    document.getElementById('cardAttendance').textContent = `${student.attendance.presentDays}/${student.attendance.totalDays} દિવસ (${student.attendance.percentage}%)`;
  } else {
    document.getElementById('cardAttendance').textContent = '૯૪.૫%';
  }

  // Populate Subjects Table
  const tbody = document.getElementById('cardSubjectsTbody');
  tbody.innerHTML = '';

  const subjects = student.subjects || [];
  subjects.forEach((sub, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-slate-300 text-center hover:bg-slate-50/50';

    const minPass = Math.round(sub.maxMarks * 0.33);
    const isPassing = sub.obtainedMarks >= minPass;

    tr.innerHTML = `
      <td class="border border-slate-300 p-2 text-slate-500 font-medium">${idx + 1}</td>
      <td class="border border-slate-300 p-2 text-left font-medium text-slate-800">${sub.name}</td>
      <td class="border border-slate-300 p-2 text-slate-600">${sub.maxMarks}</td>
      <td class="border border-slate-300 p-2 text-slate-500">${minPass}</td>
      <td class="border border-slate-300 p-2 font-bold ${isPassing ? 'text-slate-900' : 'text-rose-600'}">${sub.obtainedMarks}</td>
      <td class="border border-slate-300 p-2">
        <span class="inline-block px-2 py-0.5 text-xs font-bold rounded ${getGradeColorClass(sub.grade)}">
          ${sub.grade || '-'}
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Grand Totals
  document.getElementById('cardTotalMax').textContent = student.totalMaxMarks || 600;
  document.getElementById('cardTotalObtained').textContent = student.totalObtainedMarks || 0;
  document.getElementById('cardOverallGrade').textContent = student.overallGrade || '-';

  // Summary Metrics
  document.getElementById('cardPercentage').textContent = `${student.percentage}%`;
  document.getElementById('cardStatus').textContent = student.resultStatus || 'પાસ (Passed)';
  document.getElementById('cardRank').textContent = student.rank ? `${student.rank} (Rank ${student.rank})` : 'પ્રથમ વર્ગ';
  document.getElementById('cardProgressBar').style.width = `${Math.min(student.percentage, 100)}%`;

  // Personality Traits
  const traits = student.personalityTraits || {};
  document.getElementById('cardCleanliness').textContent = traits.cleanliness || 'ઉત્તમ';
  document.getElementById('cardDiscipline').textContent = traits.discipline || 'ઉત્તમ';
  document.getElementById('cardCuriosity').textContent = traits.curiosity || 'ખૂબ સારું';
  document.getElementById('cardSports').textContent = traits.sportsmanship || 'ઉત્તમ';

  // Remarks
  document.getElementById('cardTeacherRemarks').textContent = student.teacherRemarks || 'સરસ પ્રગતિ. અભિનંદન!';

  // Generate Verification QR Code
  generateQrCode(student);
}

function getGradeColorClass(grade) {
  if (!grade) return 'bg-slate-100 text-slate-700';
  if (grade.startsWith('A')) return 'bg-emerald-100 text-emerald-800';
  if (grade.startsWith('B')) return 'bg-blue-100 text-blue-800';
  if (grade.startsWith('C')) return 'bg-amber-100 text-amber-800';
  if (grade.startsWith('D')) return 'bg-orange-100 text-orange-800';
  return 'bg-rose-100 text-rose-800';
}

function generateQrCode(student) {
  const qrContainer = document.getElementById('reportQrCode');
  qrContainer.innerHTML = '';

  const verificationUrl = `${window.location.origin}/?std=${student.standard}&roll=${student.rollNo}&gr=${student.grNumber}`;

  try {
    if (typeof QRCode !== 'undefined') {
      qrCodeInstance = new QRCode(qrContainer, {
        text: verificationUrl,
        width: 56,
        height: 56,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    }
  } catch (e) {
    console.warn('QR code generator error:', e);
  }
}

// 5. WhatsApp Share
function shareOnWhatsApp() {
  if (!currentStudent) return;
  const s = currentStudent;
  const name = s.studentNameGu || s.studentName;
  const msg = `🎓 *પ્રાથમિક શાળા પરિણામ ૨૦૨૫-૨૬*\n` +
    `👤 વિદ્યાર્થી: *${name}*\n` +
    `🏫 ધોરણ: ${s.standard} | વર્ગ: ${s.division || 'A'}\n` +
    `🔢 રોલ નં: ${s.rollNo} | જી.આર. નં: ${s.grNumber}\n` +
    `📊 મેળવેલ ગુણ: *${s.totalObtainedMarks}/${s.totalMaxMarks}*\n` +
    `📈 ટકાવારી: *${s.percentage}%* | ગ્રેડ: *${s.overallGrade}*\n` +
    `✨ પરિણામ: *${s.resultStatus}*\n\n` +
    `🌐 ઓનલાઇન પરિણામ ચકાસો: ${window.location.origin}/?std=${s.standard}&roll=${s.rollNo}&gr=${s.grNumber}`;

  const shareUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
  window.open(shareUrl, '_blank');
}

// 6. Check URL Query Parameters (e.g. ?school=24140805901&s=2362 or ?std=4&roll=5&gr=2362)
function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const std = params.get('std') || params.get('standard');
  const roll = params.get('roll') || params.get('rollNo');
  const gr = params.get('gr') || params.get('grNumber') || params.get('s');

  if (std) document.getElementById('inputStandard').value = std;
  if (roll) document.getElementById('inputRollNo').value = roll;
  if (gr) document.getElementById('inputGrNumber').value = gr;

  // If all 3 are in URL, auto-search
  if (std && roll && gr) {
    handleSearchSubmit(new Event('submit'));
  }
}

// 7. Admin Portal Features
function openAdminModal() {
  document.getElementById('adminModal').classList.remove('hidden');
  if (adminAuthToken) {
    showAdminDashboard();
  } else {
    showAdminLogin();
  }
}

function closeAdminModal() {
  document.getElementById('adminModal').classList.add('hidden');
}

function showAdminLogin() {
  document.getElementById('adminLoginFormView').classList.remove('hidden');
  document.getElementById('adminDashboardView').classList.add('hidden');
}

function showAdminDashboard() {
  document.getElementById('adminLoginFormView').classList.add('hidden');
  document.getElementById('adminDashboardView').classList.remove('hidden');
  loadAdminStudentsList();
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const username = document.getElementById('adminUsername').value.trim();
  const password = document.getElementById('adminPassword').value.trim();
  const errorBox = document.getElementById('adminLoginError');
  errorBox.classList.add('hidden');

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success && data.token) {
      adminAuthToken = data.token;
      localStorage.setItem('school_admin_token', adminAuthToken);
      showAdminDashboard();
    } else {
      errorBox.textContent = data.message || 'લૉગિન નિષ્ફળ!';
      errorBox.classList.remove('hidden');
    }
  } catch (err) {
    errorBox.textContent = 'સર્વર કનેક્શન એરર!';
    errorBox.classList.remove('hidden');
  }
}

function handleAdminLogout() {
  adminAuthToken = null;
  localStorage.removeItem('school_admin_token');
  showAdminLogin();
}

function switchAdminTab(tabName) {
  const tabs = ['students', 'add', 'bulk', 'password'];
  tabs.forEach(t => {
    const btn = document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}StudentBtn`) ||
                document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}StudentsBtn`) ||
                document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}UploadBtn`) ||
                document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}Btn`);
    const pane = document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}`) ||
                 document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}Student`) ||
                 document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}Students`) ||
                 document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}Upload`);

    if (t === tabName) {
      if (btn) {
        btn.classList.add('border-b-2', 'border-emerald-600', 'text-emerald-700', 'bg-white');
        btn.classList.remove('text-slate-600');
      }
      if (pane) pane.classList.remove('hidden');
    } else {
      if (btn) {
        btn.classList.remove('border-b-2', 'border-emerald-600', 'text-emerald-700', 'bg-white');
        btn.classList.add('text-slate-600');
      }
      if (pane) pane.classList.add('hidden');
    }
  });
}

let cachedStudents = [];

async function loadAdminStudentsList() {
  try {
    const res = await fetch('/api/admin/students', {
      headers: { 'Authorization': `Bearer ${adminAuthToken}` }
    });
    const data = await res.json();
    if (data.success && data.students) {
      cachedStudents = data.students;
      document.getElementById('totalStudentsCount').textContent = data.students.length;
      renderAdminStudentsTable(cachedStudents);
    }
  } catch (err) {
    console.error('Failed to load students:', err);
  }
}

function renderAdminStudentsTable(students) {
  const tbody = document.getElementById('adminStudentsTbody');
  tbody.innerHTML = '';

  if (students.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-slate-400">કોઈ વિદ્યાર્થી ઉપલબ્ધ નથી.</td></tr>';
    return;
  }

  students.forEach(s => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 transition';
    tr.innerHTML = `
      <td class="p-2.5 font-bold text-slate-900">${s.grNumber}</td>
      <td class="p-2.5 text-slate-700">ધોરણ ${s.standard} (${s.division || 'A'})</td>
      <td class="p-2.5 font-semibold text-primaryBlue-700">${(s.rollNo !== null && s.rollNo !== undefined && s.rollNo !== '') ? s.rollNo : '-'}</td>
      <td class="p-2.5">
        <div class="font-bold text-slate-900">${s.studentNameGu || s.studentName}</div>
        <div class="text-[10px] text-slate-400">${s.studentName || ''}</div>
      </td>
      <td class="p-2.5 font-bold text-slate-800">${s.totalObtainedMarks || 0} / ${s.totalMaxMarks || 600}</td>
      <td class="p-2.5 font-bold text-emerald-700">${s.percentage || 0}%</td>
      <td class="p-2.5">
        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${getGradeColorClass(s.overallGrade)}">
          ${s.overallGrade || '-'}
        </span>
      </td>
      <td class="p-2.5 text-right space-x-1">
        <button onclick="viewStudentDirectly('${s.grNumber}', '${s.standard}', '${s.rollNo || ''}')" class="text-emerald-600 hover:text-emerald-800 p-1" title="પરિણામ જુઓ">
          <i class="fa-solid fa-eye"></i>
        </button>
        <button onclick="deleteStudent('${s.id}')" class="text-rose-500 hover:text-rose-700 p-1" title="ડિલીટ કરો">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function handleAdminStudentFilter(e) {
  const q = e.target.value.toLowerCase().trim();
  if (!q) {
    renderAdminStudentsTable(cachedStudents);
    return;
  }
  const filtered = cachedStudents.filter(s => {
    const nameMatch = (s.studentName && s.studentName.toLowerCase().includes(q)) ||
                      (s.studentNameGu && s.studentNameGu.includes(q));
    const grMatch = s.grNumber && s.grNumber.toLowerCase().includes(q);
    const rollMatch = String(s.rollNo) === q;
    const stdMatch = String(s.standard) === q;
    return nameMatch || grMatch || rollMatch || stdMatch;
  });
  renderAdminStudentsTable(filtered);
}

window.viewStudentDirectly = function(grNumber, standard, rollNo) {
  closeAdminModal();
  document.getElementById('inputStandard').value = standard;
  document.getElementById('inputRollNo').value = rollNo;
  document.getElementById('inputGrNumber').value = grNumber;
  handleSearchSubmit(new Event('submit'));
};

window.deleteStudent = async function(studentId) {
  if (!confirm('શું તમે ખરેખર આ વિદ્યાર્થીનું પરિણામ ડિલીટ કરવા માંગો છો?')) return;
  try {
    const res = await fetch(`/api/admin/students/${studentId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminAuthToken}` }
    });
    const data = await res.json();
    if (data.success) {
      alert('વિદ્યાર્થી પરિણામ સફળતાપૂર્વક ડિલીટ થયું!');
      loadAdminStudentsList();
    } else {
      alert(data.message || 'ડિલીટ નિષ્ફળ!');
    }
  } catch (err) {
    alert('સર્વર એરર!');
  }
};

// 8. Add Student Submission
async function handleAddStudentSubmit(e) {
  e.preventDefault();
  const grNumber = document.getElementById('addGrNumber').value.trim();
  const standard = document.getElementById('addStandard').value;
  const division = document.getElementById('addDivision').value.trim();
  const rollVal = document.getElementById('addRollNo').value.trim();
  const rollNo = rollVal !== '' ? parseInt(rollVal, 10) : null;
  const studentName = document.getElementById('addStudentName').value.trim();
  const studentNameGu = document.getElementById('addStudentNameGu').value.trim();
  const fatherName = document.getElementById('addFatherName').value.trim();
  const motherName = document.getElementById('addMotherName').value.trim();
  const dob = document.getElementById('addDob').value;

  const subjects = [
    { name: "Gujarati (પ્રથમ ભાષા)", code: "GUJ", maxMarks: 100, obtainedMarks: Number(document.getElementById('markGujarati').value) || 0 },
    { name: "Mathematics (ગણિત)", code: "MATH", maxMarks: 100, obtainedMarks: Number(document.getElementById('markMath').value) || 0 },
    { name: "Environment / Science (વિજ્ઞાન)", code: "SCI", maxMarks: 100, obtainedMarks: Number(document.getElementById('markEvs').value) || 0 },
    { name: "English (અંગ્રેજી)", code: "ENG", maxMarks: 100, obtainedMarks: Number(document.getElementById('markEnglish').value) || 0 },
    { name: "Hindi (હિન્દી)", code: "HIN", maxMarks: 100, obtainedMarks: Number(document.getElementById('markHindi').value) || 0 },
    { name: "Drawing (ચિત્રકામ)", code: "ART", maxMarks: 50, obtainedMarks: Number(document.getElementById('markDrawing').value) || 0 },
    { name: "Physical Education (શારીરિક શિક્ષણ)", code: "PE", maxMarks: 50, obtainedMarks: Number(document.getElementById('markPe').value) || 0 }
  ];

  const sanskritVal = document.getElementById('markSanskrit') ? document.getElementById('markSanskrit').value.trim() : '';
  if (sanskritVal !== '') {
    subjects.push({ name: "Sanskrit (સંસ્કૃત)", code: "SKT", maxMarks: 100, obtainedMarks: Number(sanskritVal) || 0 });
  }

  const payload = {
    grNumber, standard, division, rollNo, studentName, studentNameGu,
    fatherName, motherName, dob, subjects, examType: 'Annual',
    attendance: { totalDays: 220, presentDays: 205, percentage: 93.18 }
  };

  try {
    const res = await fetch('/api/admin/students', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminAuthToken}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      alert('વિદ્યાર્થી પરિણામ સફળતાપૂર્વક ઉમેરાઈ ગયું!');
      document.getElementById('addStudentForm').reset();
      switchAdminTab('students');
      loadAdminStudentsList();
    } else {
      alert(data.message || 'ભૂલ આવી!');
    }
  } catch (err) {
    alert('સર્વર સાથે સંપર્કમાં ભૂલ!');
  }
}

// 9. Bulk Excel / CSV Upload Submission
async function handleExcelUploadSubmit(e) {
  e.preventDefault();
  const fileInput = document.getElementById('excelFileInput') || document.getElementById('csvFileInput');
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    alert('કૃપા કરીને Excel (.xlsx) અથવા CSV ફાઈલ પસંદ કરો.');
    return;
  }

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('excelFile', file);

  const btn = document.getElementById('btnUploadExcel');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> પ્રોસેસ થઈ રહ્યું છે...';
  }

  try {
    const res = await fetch('/api/admin/upload-excel', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminAuthToken}` },
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      alert(data.message || 'Excel ફાઈલ સફળતાપૂર્વક અપડેટ થઈ ગઈ!');
      fileInput.value = '';
      switchAdminTab('students');
      loadAdminStudentsList();
    } else {
      alert(data.message || 'અપલોડ નિષ્ફળ!');
    }
  } catch (err) {
    alert('Excel અપલોડ કરવામાં સર્વર એરર આવી: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> અપલોડ અને અપડેટ કરો';
    }
  }
}

// 10. Admin Change Password
async function handlePasswordChangeSubmit(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('currentPassInput').value.trim();
  const newPassword = document.getElementById('newPassInput').value.trim();
  const confirmPassword = document.getElementById('confirmPassInput').value.trim();
  const alertBox = document.getElementById('passwordChangeAlert');

  alertBox.classList.add('hidden');

  if (newPassword !== confirmPassword) {
    alertBox.textContent = 'નવો પાસવર્ડ અને કન્ફર્મ પાસવર્ડ મેળ ખાતા નથી!';
    alertBox.className = 'text-xs p-2 rounded bg-rose-50 text-rose-700 block';
    return;
  }

  try {
    const res = await fetch('/api/admin/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminAuthToken}`
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json();
    if (data.success) {
      alertBox.textContent = '✅ ' + data.message;
      alertBox.className = 'text-xs p-2 rounded bg-emerald-50 text-emerald-800 font-semibold block';
      document.getElementById('changePasswordForm').reset();
    } else {
      alertBox.textContent = '❌ ' + (data.message || 'પાસવર્ડ બદલવામાં ભૂલ આવી!');
      alertBox.className = 'text-xs p-2 rounded bg-rose-50 text-rose-700 block';
    }
  } catch (err) {
    alertBox.textContent = 'સર્વર સાથે સંપર્ક કરવામાં એરર!';
    alertBox.className = 'text-xs p-2 rounded bg-rose-50 text-rose-700 block';
  }
}

// 11. Admin Export CSV
async function handleAdminExportCsv() {
  try {
    const res = await fetch('/api/admin/export-csv', {
      headers: { 'Authorization': `Bearer ${adminAuthToken}` }
    });
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `satpada_students_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    alert('Excel ડાઉનલોડ કરવામાં એરર આવી!');
  }
}
