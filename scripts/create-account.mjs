// Firebase Auth REST API로 계정 생성 (SDK 불필요)
const API_KEY    = 'AIzaSyD60h98U3EhQrBofE-xwg29DhYxrdz0BUk';
const PROJECT_ID = 'tracker-9b4d2';
const USERNAME   = 'harinmin';
const AUTH_EMAIL = `${USERNAME}@helo.app`;
// 비밀번호는 코드에 적지 않고 실행할 때 넘긴다:
//   node scripts/create-account.mjs <비밀번호>
//   또는 ACCOUNT_PASSWORD 환경변수
const PASSWORD   = process.argv[2] || process.env.ACCOUNT_PASSWORD;

async function createOrLoginAuth() {
  // 1. 계정 생성 시도
  let res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email:AUTH_EMAIL, password:PASSWORD, returnSecureToken:true }) }
  );
  let data = await res.json();

  if (data.error?.message === 'EMAIL_EXISTS') {
    console.log('계정이 이미 존재합니다. 로그인 시도...');
    res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email:AUTH_EMAIL, password:PASSWORD, returnSecureToken:true }) }
    );
    data = await res.json();
    if (data.error) { console.error('로그인 실패:', data.error.message); return null; }
    console.log('기존 계정 로그인 성공');
  } else if (data.error) {
    console.error('계정 생성 실패:', data.error.message);
    return null;
  } else {
    console.log('✅ Firebase Auth 계정 생성 완료');
  }
  return { uid: data.localId, idToken: data.idToken };
}

async function writeToFirestore(uid, idToken) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/usernames/${USERNAME}`;
  const body = { fields: {
    uid:       { stringValue: uid },
    authEmail: { stringValue: AUTH_EMAIL },
    hasEmail:  { booleanValue: false },
    createdAt: { timestampValue: new Date().toISOString() },
  }};
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${idToken}` },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.error) { console.error('Firestore 저장 실패:', data.error); return false; }
  return true;
}

async function main() {
  if (!PASSWORD || PASSWORD.length < 6) {
    console.error('사용법: node scripts/create-account.mjs <비밀번호(6자 이상)>');
    process.exit(1);
  }
  console.log(`\n계정 생성 중: ${USERNAME}\n`);
  const auth = await createOrLoginAuth();
  if (!auth) process.exit(1);

  console.log('UID:', auth.uid);
  const ok = await writeToFirestore(auth.uid, auth.idToken);
  if (!ok) process.exit(1);

  console.log('\n🎉 완료!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  아이디  : ${USERNAME}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('앱에서 로그인하면 기존 데이터가 자동으로 연결됩니다.\n');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
