// 내 컬렉션 위젯 — Scriptable 용 (중간/가로형 위젯)
// 왼쪽: 지금 진행 중(ing)인 작품 썸네일 (여러 개면 랜덤)
// 오른쪽: 바로가기 버튼 (게임 → 게임 일기, 영상 → 리뷰, 책 → 독서 기록)
//
// 처음 한 번은 Scriptable 앱에서 이 스크립트를 실행해 로그인하세요.
// 비밀번호는 저장하지 않고, 로그인 토큰만 iPhone 키체인에 보관합니다.

const APP_URL = 'https://garinming.github.io/contents-tracker/';
const API_KEY = 'AIzaSyD60h98U3EhQrBofE-xwg29DhYxrdz0BUk';
const PROJECT = 'tracker-9b4d2';
const KC_KEY = 'contents_tracker_auth';
const CACHE = 'contents_tracker_widget_cache.json';

const ACCENT = new Color('#FF6B9D');
const TYPES = {
  game:  { emoji: '🎮', label: 'NOW PLAYING',  btn: '게임 일기', go: 'diary' },
  video: { emoji: '🎬', label: 'NOW WATCHING', btn: '리뷰 쓰기', go: 'review' },
  book:  { emoji: '📚', label: 'NOW READING',  btn: '독서 기록', go: 'review' },
  novel: { emoji: '📖', label: 'NOW READING',  btn: '소설 기록', go: 'review' },
  comic: { emoji: '📔', label: 'NOW READING',  btn: '만화 기록', go: 'review' },
};

const C = {
  bgTop:    Color.dynamic(new Color('#FFF1F6'), new Color('#2B1D24')),
  bgBottom: Color.dynamic(new Color('#FFFFFF'), new Color('#1C1C1E')),
  text:     Color.dynamic(new Color('#1A1A2E'), new Color('#F5F5F7')),
  sub:      Color.dynamic(new Color('#8E8E93'), new Color('#98989F')),
  chip:     Color.dynamic(new Color('#FF6B9D', 0.13), new Color('#FF6B9D', 0.22)),
  ph:       Color.dynamic(new Color('#F2F2F7'), new Color('#2C2C2E')),
};

/* ── 인증 ── */
async function postJSON(url, body, headers = { 'Content-Type': 'application/json' }) {
  const r = new Request(url);
  r.method = 'POST';
  r.headers = headers;
  r.body = body;
  return r.loadJSON();
}

async function login() {
  const a = new Alert();
  a.title = '내 컬렉션 로그인';
  a.message = '웹앱과 같은 아이디 / 비밀번호\n(비밀번호는 저장되지 않아요)';
  a.addTextField('아이디');
  a.addSecureTextField('비밀번호');
  a.addAction('로그인');
  a.addCancelAction('취소');
  if ((await a.presentAlert()) === -1) return null;
  const id = a.textFieldValue(0).trim().toLowerCase();
  const pw = a.textFieldValue(1);
  const d = await postJSON(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    JSON.stringify({ email: `${id}@helo.app`, password: pw, returnSecureToken: true })
  );
  if (d.error) {
    const e = new Alert();
    e.title = '로그인 실패';
    e.message = d.error.message;
    e.addAction('확인');
    await e.presentAlert();
    return null;
  }
  Keychain.set(KC_KEY, JSON.stringify({ refreshToken: d.refreshToken, uid: d.localId }));
  return { idToken: d.idToken, uid: d.localId };
}

async function getAuth() {
  if (!Keychain.contains(KC_KEY)) return config.runsInWidget ? null : login();
  const saved = JSON.parse(Keychain.get(KC_KEY));
  const d = await postJSON(
    `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`,
    `grant_type=refresh_token&refresh_token=${encodeURIComponent(saved.refreshToken)}`,
    { 'Content-Type': 'application/x-www-form-urlencoded' }
  );
  if (d.error) {
    Keychain.remove(KC_KEY);
    return config.runsInWidget ? null : login();
  }
  if (d.refresh_token && d.refresh_token !== saved.refreshToken) {
    Keychain.set(KC_KEY, JSON.stringify({ refreshToken: d.refresh_token, uid: saved.uid }));
  }
  return { idToken: d.id_token, uid: d.user_id || saved.uid };
}

/* ── 데이터 ── */
async function fetchInProgress(auth) {
  const rows = await postJSON(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,
    JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'items' }],
        where: { compositeFilter: { op: 'AND', filters: [
          { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: auth.uid } } },
          { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'ing' } } },
        ] } },
      },
    }),
    { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.idToken}` }
  );
  if (!Array.isArray(rows)) throw new Error(rows?.error?.message || rows?.[0]?.error?.message || '불러오기 실패');
  return rows.filter(x => x.document).map(x => {
    const f = x.document.fields || {};
    return {
      id: x.document.name.split('/').pop(),
      title: f.title?.stringValue || '제목 없음',
      type: f.type?.stringValue || 'game',
      cover: f.cover?.stringValue || null,
    };
  });
}

const fm = FileManager.local();
const cachePath = fm.joinPath(fm.cacheDirectory(), CACHE);
function saveCache(list) { try { fm.writeString(cachePath, JSON.stringify(list)); } catch (e) { /* ignore */ } }
function loadCache() { try { return fm.fileExists(cachePath) ? JSON.parse(fm.readString(cachePath)) : null; } catch (e) { return null; } }

async function loadCover(url) {
  if (!url || !/^https?:/.test(url)) return null;
  try {
    const r = new Request(url);
    r.timeoutInterval = 8;
    return await r.loadImage();
  } catch (e) { return null; }
}

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const link = (go, id) => `${APP_URL}?go=${go}${id ? `&item=${encodeURIComponent(id)}` : ''}`;

/* ── 위젯 그리기 ── */
function baseWidget() {
  const w = new ListWidget();
  const g = new LinearGradient();
  g.colors = [C.bgTop, C.bgBottom];
  g.locations = [0, 1];
  g.startPoint = new Point(0, 0);
  g.endPoint = new Point(1, 1);
  w.backgroundGradient = g;
  w.setPadding(12, 12, 12, 14);
  w.url = APP_URL;
  w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
  return w;
}

function addButton(stack, emoji, label, url, primary) {
  const b = stack.addStack();
  b.layoutHorizontally();
  b.centerAlignContent();
  b.size = new Size(0, 30);
  b.setPadding(0, 10, 0, 10);
  b.cornerRadius = 15;
  b.backgroundColor = primary ? ACCENT : C.chip;
  b.url = url;
  const e = b.addText(emoji);
  e.font = Font.systemFont(13);
  b.addSpacer(5);
  const t = b.addText(label);
  t.font = Font.semiboldRoundedSystemFont(13);
  t.textColor = primary ? Color.white() : ACCENT;
  t.lineLimit = 1;
  b.addSpacer();
  const arrow = b.addText('›');
  arrow.font = Font.boldRoundedSystemFont(15);
  arrow.textColor = primary ? Color.white() : ACCENT;
}

function messageWidget(title, body, url) {
  const w = baseWidget();
  if (url) w.url = url;
  const h = w.addText('내 컬렉션');
  h.font = Font.heavyRoundedSystemFont(11);
  h.textColor = ACCENT;
  w.addSpacer(6);
  const t = w.addText(title);
  t.font = Font.boldRoundedSystemFont(16);
  t.textColor = C.text;
  w.addSpacer(4);
  const b = w.addText(body);
  b.font = Font.mediumRoundedSystemFont(12);
  b.textColor = C.sub;
  w.addSpacer();
  return w;
}

async function buildWidget(items) {
  if (!items.length) {
    const w = messageWidget('진행 중인 게 없어요', '라이브러리에서 상태를 ing로 바꾸면\n여기에 떠요 ✨', APP_URL);
    return w;
  }

  const featured = pick(items);
  const ft = TYPES[featured.type] || TYPES.game;

  // 버튼: 보여주는 작품의 종류가 먼저, 그다음 다른 종류 하나 (최대 2개)
  const byType = {};
  items.forEach(i => { (byType[i.type] = byType[i.type] || []).push(i); });
  const otherTypes = Object.keys(byType).filter(t => t !== featured.type && TYPES[t]);
  const buttons = [{ type: featured.type, item: featured }];
  if (otherTypes.length) {
    const t = pick(otherTypes);
    buttons.push({ type: t, item: pick(byType[t]) });
  }

  const w = baseWidget();
  const row = w.addStack();
  row.layoutHorizontally();

  // 왼쪽: 썸네일
  const coverImg = await loadCover(featured.cover);
  const left = row.addStack();
  left.size = new Size(92, 130);
  left.cornerRadius = 14;
  left.url = link('item', featured.id);
  if (coverImg) {
    left.backgroundImage = coverImg;
  } else {
    left.backgroundColor = C.ph;
    left.centerAlignContent();
    left.addSpacer();
    const ph = left.addText(ft.emoji);
    ph.font = Font.systemFont(34);
    left.addSpacer();
  }

  row.addSpacer(12);

  // 오른쪽: 라벨, 제목, 버튼
  const right = row.addStack();
  right.layoutVertically();
  right.size = new Size(0, 130);

  const lab = right.addStack();
  lab.layoutHorizontally();
  lab.centerAlignContent();
  const labText = lab.addText(`${ft.emoji} ${ft.label}`);
  labText.font = Font.heavyRoundedSystemFont(10);
  labText.textColor = ACCENT;
  if (items.length > 1) {
    lab.addSpacer(5);
    const cnt = lab.addText(`· ${items.length}개 진행 중`);
    cnt.font = Font.semiboldRoundedSystemFont(10);
    cnt.textColor = C.sub;
  }

  right.addSpacer(4);
  const title = right.addText(featured.title);
  title.font = Font.boldRoundedSystemFont(16);
  title.textColor = C.text;
  title.lineLimit = 2;
  title.minimumScaleFactor = 0.8;
  title.url = link('item', featured.id);

  right.addSpacer();

  buttons.forEach((b, i) => {
    const t = TYPES[b.type];
    const label = i === 0 ? t.btn : `${t.btn} · ${b.item.title}`;
    addButton(right, t.emoji, label, link(t.go, b.item.id), i === 0);
    if (i < buttons.length - 1) right.addSpacer(6);
  });

  return w;
}

/* ── 실행 ── */
async function run() {
  if (config.runsInApp && Keychain.contains(KC_KEY)) {
    const a = new Alert();
    a.title = '내 컬렉션 위젯';
    a.addAction('미리보기');
    a.addAction('다시 로그인');
    a.addCancelAction('닫기');
    const sel = await a.presentAlert();
    if (sel === -1) return;
    if (sel === 1) Keychain.remove(KC_KEY);
  }

  let widget;
  let auth = null;
  try { auth = await getAuth(); } catch (e) { auth = null; }

  if (!auth) {
    const cached = loadCache();
    widget = cached && Keychain.contains(KC_KEY)
      ? await buildWidget(cached)
      : messageWidget('로그인이 필요해요', 'Scriptable 앱에서 이 스크립트를\n한 번 실행해 로그인해 주세요');
  } else {
    try {
      const items = await fetchInProgress(auth);
      saveCache(items);
      widget = await buildWidget(items);
    } catch (e) {
      const cached = loadCache();
      widget = cached ? await buildWidget(cached) : messageWidget('불러오지 못했어요', String(e.message || e));
    }
  }

  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    await widget.presentMedium();
  }
  Script.complete();
}

await run();
