// Offline self-test for the security fixes (no database, Keycloak or Docker needed).
// The DB connection and the Keycloak admin client are replaced with in-memory stubs.
//
// Usage from the repo root:
//   npm install --no-save jsonwebtoken@9 uuid@9
//   node scripts/security_selftest.js
// Expect: "N passed, 0 failed". Exit code 1 on any failure.
const Module = require('module');
const path = require('path');
const crypto = require('crypto');
const REPO = path.join(__dirname, '..');
const REAL_ERR = console.error, REAL_LOG = console.log;

// ---------------------------------------------------------------- stubs
// Per-table answers for .first(); a function receives the recorded where() calls.
const db = {};
const calls = [];
const whereObj = (q) => Object.assign({}, ...q._wheres.filter(w => w.length === 1 && typeof w[0] === 'object').map(w => w[0]));
function fakeKnex(table) {
  const q = {
    table, _wheres: [],
    where(...a) { q._wheres.push(a); return q; },
    orWhere() { return q; }, whereNull() { return q; }, whereIn() { return q; }, whereRaw() { return q; },
    select() { return q; }, join() { return q; }, leftJoin() { return q; }, orderBy() { return q; },
    first: async () => (typeof db[table] === 'function' ? db[table](q) : (db[table] || null)),
    update(data) { calls.push({ table, op: 'update', data, where: whereObj(q) });
      const p = Promise.resolve(1); p.returning = async () => [{ ...(typeof db[table] === 'function' ? {} : db[table]), ...data }]; return p; },
    insert(data) { calls.push({ table, op: 'insert', data }); const p = Promise.resolve([data]); p.returning = async () => [data]; return p; },
    delete: async () => 1
  };
  return q;
}
fakeKnex.raw = (s) => s;
fakeKnex.fn = { now: () => new Date() };
fakeKnex.transaction = async (cb) => (cb ? cb(fakeKnex) : { commit: async () => {}, rollback: async () => {}, ...fakeKnex });

const kc = { calls: [] };
const fakeKeycloak = {
  createUser: async (u) => { kc.calls.push(['createUser', u.email]); if (kc.createUserExists) throw new Error('User already exists in Keycloak'); return 'new-kc-id'; },
  getUserByEmail: async (e) => { kc.calls.push(['getUserByEmail', e]); return { id: 'existing-kc-id' }; },
  resetPassword: async (id, pw) => { kc.calls.push(['resetPassword', id]); return true; },
  deleteUser: async (id) => { kc.calls.push(['deleteUser', id]); return true; },
  updateUser: async () => true
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith('db/connection')) return fakeKnex;
  if (request === 'knex') return () => fakeKnex; // secondary connections (e.g. GSP DB in connectorModel)
  if (request.endsWith('services/keycloakService')) return fakeKeycloak;
  if (request.endsWith('nats/client')) return { publishMessage() {}, subscribeToSubject() {}, connectNats: async () => {} };
  return origLoad.apply(this, arguments);
};

const jwt = require('jsonwebtoken');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const mkRes = () => { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const call = async (fn, req) => { const res = mkRes(); let nexted = false; await fn(req, res, () => { nexted = true; }); return { res, nexted }; };
const reset = () => { for (const k of Object.keys(db)) delete db[k]; calls.length = 0; kc.calls.length = 0; kc.createUserExists = false; };

const U_ADMIN = '11111111-1111-4111-8111-111111111111';
const U_USER = '22222222-2222-4222-8222-222222222222';
const WS_OWN = '33333333-3333-4333-8333-333333333333';
const WS_VICTIM = '44444444-4444-4444-8444-444444444444';
const GSTIN_ID = '55555555-5555-4555-8555-555555555555';

(async () => {
  const quiet = console.error; const quietLog = console.log;
  console.error = () => {}; console.warn = () => {};
  const log = (...a) => quietLog(...a);
  console.log = (...a) => { if (typeof a[0] === 'string' && /^(PASS|FAIL|\n?\d+ passed)/.test(a[0])) quietLog(...a); };

  // ================= 1. JWT verification (authMiddleware) =================
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const pubBody = pubPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const attacker = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const claims = { sub: 'kc-123', email: 'victim@company.com', role: 'SUPER_ADMIN', groups: ['Super Admin', 'super-admin'] };
  const withToken = (t) => ({ headers: t ? { authorization: `Bearer ${t}` } : {} });

  delete process.env.KEYCLOAK_PUBLIC_KEY;
  const { verifyToken } = require(path.join(REPO, 'services/shared/src/middleware/authMiddleware.js'));
  db.users = { id: U_USER, tenant_id: 't1' };
  let r = await call(verifyToken, withToken(jwt.sign(claims, privateKey, { algorithm: 'RS256', expiresIn: '5m' })));
  check('auth: no KEYCLOAK_PUBLIC_KEY -> 503, not passed through', r.res.code === 503 && !r.nexted);
  process.env.KEYCLOAK_PUBLIC_KEY = pubBody;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  r = await call(verifyToken, withToken(`${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 })}.`));
  check('auth: forged alg=none token -> 403', r.res.code === 403 && !r.nexted);
  r = await call(verifyToken, withToken(jwt.sign(claims, 'anything', { algorithm: 'HS256', expiresIn: '5m' })));
  check('auth: forged HS256 token -> 403', r.res.code === 403 && !r.nexted);
  r = await call(verifyToken, withToken(jwt.sign(claims, attacker, { algorithm: 'RS256', expiresIn: '5m' })));
  check('auth: token signed by wrong key -> 403', r.res.code === 403 && !r.nexted);
  r = await call(verifyToken, withToken(jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 60 }, privateKey, { algorithm: 'RS256' })));
  check('auth: expired genuine token -> 401 (refresh flow works)', r.res.code === 401 && r.res.body.error === 'Token expired');
  const goodReq = withToken(jwt.sign(claims, privateKey, { algorithm: 'RS256', expiresIn: '5m' }));
  r = await call(verifyToken, goodReq);
  check('auth: genuine token -> accepted with db_id', r.nexted && goodReq.user && goodReq.user.db_id === U_USER);
  process.env.KEYCLOAK_PUBLIC_KEY = pubPem.replace(/\n/g, '\\n');
  r = await call(verifyToken, withToken(jwt.sign(claims, privateKey, { algorithm: 'RS256', expiresIn: '5m' })));
  check('auth: KEYCLOAK_PUBLIC_KEY as escaped PEM also works', r.nexted);
  r = await call(verifyToken, withToken(null));
  check('auth: missing token -> 401', r.res.code === 401 && !r.nexted);

  // ================= 2. Required secrets =================
  const rs = require(path.join(REPO, 'services/shared/src/utils/requiredSecrets.js'));
  delete process.env.JWT_SECRET;
  check('secrets: unset -> rejected', /not set/.test(rs.getSecretProblem('JWT_SECRET') || ''));
  process.env.JWT_SECRET = 'change-this-secret-in-production';
  check('secrets: old committed default -> rejected', /placeholder/.test(rs.getSecretProblem('JWT_SECRET') || ''));
  process.env.JWT_SECRET = 'CHANGE_ME';
  check('secrets: CHANGE_ME placeholder -> rejected', /placeholder/.test(rs.getSecretProblem('JWT_SECRET') || ''));
  process.env.JWT_SECRET = 'short';
  check('secrets: too short -> rejected', /at least 32/.test(rs.getSecretProblem('JWT_SECRET') || ''));
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64');
  check('secrets: strong value -> ok', rs.getSecretProblem('JWT_SECRET') === null);
  const { spawnSync } = require('child_process');
  const rsPath = JSON.stringify(path.join(REPO, 'services/shared/src/utils/requiredSecrets.js'));
  let child = spawnSync(process.execPath, ['-e', `require(${rsPath}).assertRequiredSecrets(['JWT_SECRET'], 'test'); console.log('STARTED')`], { env: { PATH: process.env.PATH, JWT_SECRET: 'change-this-secret-in-production' }, encoding: 'utf8' });
  check('secrets: service refuses to start with placeholder (exit 1)', child.status === 1 && !child.stdout.includes('STARTED'));
  child = spawnSync(process.execPath, ['-e', `require(${rsPath}).assertRequiredSecrets(['JWT_SECRET'], 'test'); console.log('STARTED')`], { env: { PATH: process.env.PATH, JWT_SECRET: crypto.randomBytes(48).toString('base64') }, encoding: 'utf8' });
  check('secrets: service starts with a strong secret', child.status === 0 && child.stdout.includes('STARTED'));

  // ================= 3. GSTN encryption =================
  const enc = require(path.join(REPO, 'services/shared/src/utils/encryption.js'));
  delete process.env.GSTN_ENCRYPTION_KEY;
  let threw = false; try { enc.encrypt('portal-pass'); } catch (e) { threw = true; }
  check('gstn-key: encrypt() refuses without GSTN_ENCRYPTION_KEY', threw);
  process.env.GSTN_ENCRYPTION_KEY = 'CHANGE_THIS_IN_PRODUCTION_USE_ENV_VAR_32CHARS_MIN';
  threw = false; try { enc.encrypt('portal-pass'); } catch (e) { threw = true; }
  check('gstn-key: encrypt() refuses the old public default key', threw);
  process.env.GSTN_ENCRYPTION_KEY = crypto.randomBytes(48).toString('base64');
  check('gstn-key: round trip with a real key', enc.decrypt(enc.encrypt('portal-pass')) === 'portal-pass');

  // ================= 4. Platform super admin is a DB flag =================
  const pa = require(path.join(REPO, 'services/shared/src/utils/platformAdmin.js'));
  const wa = require(path.join(REPO, 'services/shared/src/utils/workspaceAccess.js'));
  check('admin: the old backdoor email alone is NOT a super admin', !pa.isPlatformSuperAdmin({ email: 'superadmin.dev@gmail.com', metadata: {} }));
  check('admin: users.metadata.platform_role grants it', pa.isPlatformSuperAdmin({ metadata: { platform_role: 'SUPER_ADMIN' } }));
  check('admin: inactive account is not honoured', !pa.isPlatformSuperAdmin({ is_active: false, metadata: { platform_role: 'SUPER_ADMIN' } }));
  reset(); db.users = { id: U_ADMIN, metadata: { platform_role: 'SUPER_ADMIN' } };
  check('admin: isPlatformSuperAdminById reads the DB flag', await wa.isPlatformSuperAdminById(U_ADMIN));
  check('admin: non-UUID id (e.g. a Keycloak sub) is never admin', !(await wa.isPlatformSuperAdminById('kc-123')));

  // ================= 5. Workspace access ignores token role/groups claims =================
  const { authorizeWorkspace } = require(path.join(REPO, 'services/workspace-service/src/middleware/workspaceAuthMiddleware.js'));
  reset(); db.users = { id: U_USER, metadata: {} }; db.workspace_users = null;
  r = await call(authorizeWorkspace, { user: { db_id: U_USER, role: 'SUPER_ADMIN', groups: ['super-admin', 'Super Admin'] }, headers: { 'x-workspace-id': WS_VICTIM }, params: {}, query: {}, body: {} });
  check('workspace: role/groups claims no longer bypass membership -> 403', r.res.code === 403 && !r.nexted);
  reset(); db.users = { id: U_ADMIN, metadata: { platform_role: 'SUPER_ADMIN' } };
  r = await call(authorizeWorkspace, { user: { db_id: U_ADMIN }, headers: { 'x-workspace-id': WS_VICTIM }, params: {}, query: {}, body: {} });
  check('workspace: DB-verified platform admin is allowed', r.nexted);
  reset(); db.users = { id: U_USER, metadata: {} }; db.workspace_users = (q) => (whereObj(q).workspace_id === WS_OWN ? { role: 'ACCOUNTANT' } : null);
  r = await call(authorizeWorkspace, { user: { db_id: U_USER }, headers: { 'x-workspace-id': WS_OWN }, params: {}, query: {}, body: {} });
  check('workspace: normal member of own workspace is allowed', r.nexted);

  // ================= 6. Connector API-key management is scoped =================
  const { requireSuperAdmin } = require(path.join(REPO, 'services/workspace-service/src/connectors/connectorController.js'));
  // U_USER is "Super Admin" of WS_OWN only (a tenant can assign that role inside its own org)
  const scoped = () => { reset(); db.users = { id: U_USER, metadata: {} };
    db.workspace_users = (q) => {
      const w = whereObj(q);
      if (w.workspace_id === WS_OWN) return { id: 'wu1', role: 'SUPER_ADMIN' };
      // The old code looked for a SUPER_ADMIN row in ANY workspace (no workspace_id filter) and found this one
      if (!w.workspace_id && w.user_id === U_USER && w.role === 'SUPER_ADMIN') return { id: 'wu1' };
      return null;
    };
    db.workspaces = { settings: { allow_tenant_api_keys: true } }; };
  scoped();
  r = await call(requireSuperAdmin, { method: 'POST', user: { db_id: U_USER }, query: {}, body: { workspace_id: WS_VICTIM } });
  check('connectors: org-level SUPER_ADMIN cannot manage ANOTHER workspace\'s keys -> 403', r.res.code === 403 && !r.nexted);
  scoped();
  r = await call(requireSuperAdmin, { method: 'POST', user: { db_id: U_USER }, query: { workspace_id: WS_OWN }, body: { workspace_id: WS_VICTIM } });
  check('connectors: authorising with ?workspace_id=own while acting on body victim -> 403', r.res.code === 403 && !r.nexted);
  scoped();
  r = await call(requireSuperAdmin, { method: 'POST', user: { db_id: U_USER }, query: {}, body: { workspace_id: WS_OWN } });
  check('connectors: org admin can still manage their own workspace (when enabled)', r.nexted);
  reset(); db.users = { id: U_ADMIN, metadata: { platform_role: 'SUPER_ADMIN' } };
  r = await call(requireSuperAdmin, { method: 'GET', user: { db_id: U_ADMIN }, query: { workspace_id: WS_VICTIM }, body: {} });
  check('connectors: platform admin can manage any workspace', r.nexted);

  // ================= 7. /auth/register can't take over accounts =================
  const auth = require(path.join(REPO, 'services/tenant-services/src/controllers/authController.js'));
  reset(); kc.createUserExists = true; db.users = { id: U_USER, email: 'victim@company.com', auth_provider_id: 'existing-kc-id' };
  r = await call(auth.register, { body: { email: 'victim@company.com', password: 'Attacker#12345', full_name: 'Mallory' }, headers: {} });
  check('register: existing Keycloak account -> 409, password NOT reset', r.res.code === 409 && !kc.calls.some(c => c[0] === 'resetPassword'));
  reset(); kc.createUserExists = false; db.users = { id: U_USER, email: 'victim@company.com', auth_provider_id: null, tenant_id: null };
  r = await call(auth.register, { body: { email: 'victim@company.com', password: 'Attacker#12345', full_name: 'Mallory' }, headers: {} });
  check('register: local-only account -> 409, new Keycloak user removed, NOT linked (and no ReferenceError)',
    r.res.code === 409 && kc.calls.some(c => c[0] === 'deleteUser' && c[1] === 'new-kc-id') && !calls.some(c => c.table === 'users' && c.op === 'update'));

  // ================= 8. gstn-service GSTIN endpoints =================
  const g = require(path.join(REPO, 'services/gstn-service/src/controllers/gstinController.js'));
  const gstinRow = { id: GSTIN_ID, gstin: '27AAAAA0000A1Z5', legal_name: 'Victim Pvt Ltd', gstin_pwd_encrypted: 'salt:iv:ct:tag' };
  reset(); db.users = { id: U_USER, metadata: {} }; db.workspace_users = (q) => (whereObj(q).workspace_id === WS_OWN ? { role: 'ACCOUNTANT' } : null); db.gstin_master = null;
  r = await call(g.createGSTIN, { user: { db_id: U_USER }, headers: { 'x-workspace-id': WS_OWN }, body: { gstin: '27BBBBB0000B1Z6', legal_name: 'Own Co', state_code: '27', gstn_password: 'portal-pass' } });
  const ins = calls.find(c => c.table === 'gstin_master' && c.op === 'insert');
  check('gstin: create writes gstin_pwd_encrypted (schema column), no workspace_id column',
    r.res.code === 200 && ins && ins.data.gstin_pwd_encrypted && !('gstn_password_encrypted' in ins.data) && !('workspace_id' in ins.data));
  check('gstin: create links the workspace via workspaces.gstin_id', calls.some(c => c.table === 'workspaces' && c.op === 'update' && c.data.gstin_id === ins.data.id));
  check('gstin: create response never contains the encrypted password', r.res.body && r.res.body.data && !('gstin_pwd_encrypted' in r.res.body.data));
  r = await call(g.createGSTIN, { user: { db_id: U_USER }, headers: { 'x-workspace-id': WS_VICTIM }, body: { gstin: '27CCCCC0000C1Z7', legal_name: 'X', state_code: '27' } });
  check('gstin: create into a workspace you are not a member of -> 403', r.res.code === 403);
  reset(); db.users = { id: U_USER, metadata: {} }; db.gstin_master = gstinRow; db.workspace_users = null;
  r = await call(g.getGSTIN, { user: { db_id: U_USER }, headers: {}, params: { id: GSTIN_ID } });
  check('gstin: reading another tenant\'s GSTIN -> 404', r.res.code === 404);
  reset(); db.users = { id: U_USER, metadata: {} }; db.gstin_master = gstinRow; db.workspace_users = { id: 'link' };
  r = await call(g.updateGSTIN, { user: { db_id: U_USER }, headers: {}, params: { id: GSTIN_ID }, body: { trade_name: 'New', legal_name: 'Hijack', gstin: 'XX', gstin_pwd_encrypted: 'evil', metadata: { a: 1 } } });
  const upd = calls.find(c => c.table === 'gstin_master' && c.op === 'update');
  check('gstin: update only writes whitelisted fields (no mass assignment)',
    r.res.code === 200 && upd && upd.data.trade_name === 'New' && !('legal_name' in upd.data) && !('gstin' in upd.data) && !('gstin_pwd_encrypted' in upd.data) && !('metadata' in upd.data));
  check('gstin: update response never contains the encrypted password', r.res.body && r.res.body.data && !('gstin_pwd_encrypted' in r.res.body.data));

  console.error = quiet; console.log = quietLog;
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log = REAL_LOG; console.error = REAL_ERR; console.error('SELFTEST CRASHED:', e); console.log(`\n${pass} passed, ${fail} failed (crashed)`); process.exit(1); });
