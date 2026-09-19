'use strict';
// Receives sensitive source rows over stdin; prints only non-identifying counts.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const auth = require('../api/_lib/school-auth.cjs');

async function build({ students, teachers, output, sourceSha256, sourceSummary, previous }) {
  if (!path.isAbsolute(output) || !fs.statSync(output).isDirectory()) throw new Error('Private output directory required');
  const old = previous ? auth.validateDirectory(JSON.parse(fs.readFileSync(previous, 'utf8'))) : null;
  const oldByLogin = new Map((old?.accounts || []).map(a => [a.login, a]));
  const teacherCredentials = [], generatedCredentials = [];
  const rows = [...students.map(a => ({ ...a, role: 'student' })), ...teachers.map(a => ({ ...a, role: 'teacher' }))];
  const accounts = new Array(rows.length); let next = 0;
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (next < rows.length) {
      const index = next++, row = rows[index], login = auth.normalizeLogin(row.login), previousAccount = oldByLogin.get(login);
      if (previousAccount && previousAccount.role !== row.role) throw new Error('Existing role changed');
      let password = row.password;
      if (!password) {
        if (previousAccount) {
          accounts[index] = { ...previousAccount, displayName: row.displayName, active: true,
            ...(row.role === 'student' ? { grade: row.grade, cls: row.cls, classNo: row.classNo } : {}) }; continue;
        }
        password = (row.role === 'teacher' ? 'T!' : 'S!') + crypto.randomBytes(15).toString('base64url');
        const entry = { role: row.role, login, displayName: row.displayName, password,
          source: row.role === 'teacher' ? 'generated_teacher_initial' : 'generated_missing_password',
          grade: row.grade || null, cls: row.cls || null, classNo: row.classNo || null, sourceRow: row.sourceRow || null };
        generatedCredentials.push(entry);
        if (row.role === 'teacher') teacherCredentials.push(entry);
      }
      // Rebuilding a roster must preserve passwords changed on the platform.
      // Password resets are explicit audited API operations, not roster side effects.
      const unchangedPassword = !!previousAccount;
      const account = { id: previousAccount?.id || (row.role === 'student' ? 's_' : 't_') + crypto.randomBytes(12).toString('hex'),
        researchId: previousAccount?.researchId || 'r_' + crypto.randomBytes(12).toString('hex'),
        role: row.role, login, displayName: row.displayName,
        grade: row.role === 'student' ? row.grade : null, cls: row.role === 'student' ? row.cls : null,
        classNo: row.role === 'student' ? row.classNo : null, active: true,
        authVersion: unchangedPassword ? previousAccount.authVersion : crypto.randomBytes(16).toString('hex'),
        authGeneration: previousAccount?.authGeneration || 0,
        passwordSource: previousAccount?.passwordSource || row.passwordSource || (row.role === 'teacher' ? 'generated_teacher_initial' : 'source_workbook'),
        password: unchangedPassword ? previousAccount.password : await auth.hashPassword(password) };
      if (!auth.validAccount(account)) throw new Error('Invalid account');
      accounts[index] = account;
    }
  }));
  // Accounts omitted by a later verified roster are retained but disabled; IDs
  // remain stable and research history never gets assigned to another pupil.
  const current = new Set(accounts.map(a => a.login));
  for (const prior of old?.accounts || []) if (!current.has(prior.login)) accounts.push({ ...prior, active: false });
  const data = { format: auth.FORMAT, generatedAt: new Date().toISOString(), sourceSha256,
    accounts, sha256: auth.directoryHash(accounts) };
  auth.validateDirectory(data);
  const write = (name, content) => fs.writeFileSync(path.join(output, name), content, { flag: 'wx', mode: 0o600 });
  write('school-accounts.snapshot.json', JSON.stringify(data));
  const csv = cell => '"' + (/^[=+@-]/.test(String(cell)) ? "'" : '') + String(cell).replace(/"/g, '""') + '"';
  write('teacher-initial-passwords.csv', '\uFEFF' + ['教師姓名,登入名稱,初始密碼',
    ...teacherCredentials.map(a => [a.displayName, a.login, a.password].map(csv).join(','))].join('\r\n'));
  write('generated-initial-passwords.private.json', JSON.stringify({ generatedAt: data.generatedAt, accounts: generatedCredentials }, null, 2));
  write('generated-initial-passwords.csv', '\uFEFF' + ['角色,姓名,登入名稱,初始密碼,來源,原表行號',
    ...generatedCredentials.map(a => [a.role, a.displayName, a.login, a.password, a.source, a.sourceRow || ''].map(csv).join(','))].join('\r\n'));
  const secret = previous ? null : crypto.randomBytes(48).toString('base64url');
  if (secret) write('school-auth.private.env', `SCHOOL_AUTH_SECRET=${secret}\nSCHOOL_AUTH_ORIGIN=https://mandarin.aiducation.asia\n`);
  const summary = { ...sourceSummary, ok: true, accounts: accounts.length, activeStudents: accounts.filter(a => a.active && a.role === 'student').length,
    activeTeachers: accounts.filter(a => a.active && a.role === 'teacher').length, generatedTeacherPasswords: teacherCredentials.length,
    generatedStudentPasswords: generatedCredentials.filter(a => a.role === 'student').length,
    accountSnapshotSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(output, 'school-accounts.snapshot.json'))).digest('hex'),
    sourceSha256, algorithm: 'scrypt N=32768 r=8 p=1; per-account random salt', published: false };
  write('import-summary.json', JSON.stringify(summary, null, 2));
  return summary;
}
if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', part => { input += part; if (input.length > 8 * 1024 * 1024) process.exit(1); });
  process.stdin.on('end', () => build(JSON.parse(input)).then(result => console.log(JSON.stringify(result))).catch(() => {
    console.error('{"ok":false,"error":"Private account preparation failed; inspect source classifications"}'); process.exitCode = 1;
  }));
}
module.exports = { build };
