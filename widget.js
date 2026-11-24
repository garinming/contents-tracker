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
// 위젯 버튼 → Safari 대신 이 스크립트를 다시 실행해서 바로 쓰기 창을 띄움
const runLink = (action, id) =>
  `scriptable:///run/${encodeURIComponent(Script.name())}?action=${action}&item=${encodeURIComponent(id)}`;

/* ── Firestore REST ── */
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const authHeaders = auth => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${auth.idToken}` });

async function getItem(auth, id) {
  const r = new Request(`${DOCS}/items/${id}`);
  r.headers = authHeaders(auth);
  const d = await r.loadJSON();
  if (d.error) throw new Error(d.error.message);
  const f = d.fields || {};
  return {
    id,
    title: f.title?.stringValue || '제목 없음',
    type: f.type?.stringValue || 'game',
    review: f.review?.stringValue || '',
    rating: Number(f.rating?.doubleValue ?? f.rating?.integerValue ?? 0) || 0,
  };
}

async function saveDiary(auth, itemId, { text, date, photos }) {
  const d = await postJSON(`${DOCS}/gameDiary`, JSON.stringify({ fields: {
    date: { stringValue: date },
    text: { stringValue: text },
    photos: { arrayValue: { values: photos.map(p => ({ stringValue: p })) } },
    createdAt: { timestampValue: new Date().toISOString() },
    userId: { stringValue: auth.uid },
    itemId: { stringValue: itemId },
  } }), authHeaders(auth));
  if (d.error) throw new Error(d.error.message);
}

async function saveReview(auth, itemId, { review, rating }) {
  const r = new Request(`${DOCS}/items/${itemId}?updateMask.fieldPaths=review&updateMask.fieldPaths=rating`);
  r.method = 'PATCH';
  r.headers = authHeaders(auth);
  r.body = JSON.stringify({ fields: { review: { stringValue: review }, rating: { doubleValue: rating } } });
  const d = await r.loadJSON();
  if (d.error) throw new Error(d.error.message);
}

/* ── 바로 쓰기 창 (WebView 시트) ── */
function sheetHTML(mode, item) {
  const t = TYPES[item.type] || TYPES.game;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const isDiary = mode === 'diary';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<style>
:root{--a:#FF6B9D;--at:rgba(255,107,157,.13);--bg:#fff;--card:#F6F6F8;--text:#1A1A2E;--sub:#8E8E93;--line:#ECECEF}
@media(prefers-color-scheme:dark){:root{--bg:#1C1C1E;--card:#2C2C2E;--text:#F5F5F7;--sub:#98989F;--line:#38383A;--at:rgba(255,107,157,.22)}}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{font-family:-apple-system,system-ui,sans-serif;background:var(--bg);color:var(--text);padding:22px 18px 40px;-webkit-font-smoothing:antialiased}
.grab{width:36px;height:5px;border-radius:3px;background:var(--line);margin:-10px auto 16px}
.lab{font-size:12px;font-weight:800;color:var(--a);letter-spacing:.4px}
h1{font-size:22px;font-weight:800;margin:3px 0 16px;line-height:1.25}
.row{display:flex;gap:8px;align-items:center;margin-bottom:12px}
.chip{position:relative;padding:8px 14px;border-radius:999px;background:var(--card);font-size:14px;font-weight:600;color:var(--sub);overflow:hidden}
.chip input{position:absolute;inset:0;opacity:0;width:100%}
.chip.on{background:var(--at);color:var(--a)}
textarea{width:100%;min-height:150px;border:none;outline:none;resize:none;background:var(--card);color:var(--text);border-radius:16px;padding:14px;font:inherit;font-size:17px;line-height:1.55}
.thumbs{display:flex;gap:8px;overflow-x:auto;margin-bottom:12px}
.thumbs:empty{display:none}
.th{position:relative;flex-shrink:0}
.th img{width:84px;height:84px;object-fit:cover;border-radius:12px;display:block}
.th b{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;font-size:15px;display:flex;align-items:center;justify-content:center}
.stars{display:flex;gap:4px;margin-bottom:12px}
.stars span{font-size:32px;color:var(--line);position:relative;line-height:1}
.stars span.f{color:var(--a)}
.stars span.h{background:linear-gradient(90deg,var(--a) 50%,var(--line) 50%);-webkit-background-clip:text;color:transparent}
.save{display:block;width:100%;margin-top:14px;padding:16px;border:none;border-radius:16px;background:var(--a);color:#fff;font-size:17px;font-weight:700}
.save:disabled{opacity:.45}
.done{display:none;text-align:center;padding:60px 0}
.done .big{font-size:52px}
.done p{margin-top:10px;font-size:17px;font-weight:700}
.done small{display:block;margin-top:6px;color:var(--sub);font-size:14px}
</style></head><body>
<div class="grab"></div>
<div id="form">
  <p class="lab">${t.emoji} ${isDiary ? 'GAME DIARY' : 'REVIEW'}</p>
  <h1>${esc(item.title)}</h1>
  ${isDiary ? `
  <div class="row">
    <label class="chip" id="pbtn">📷 사진<input id="file" type="file" accept="image/*" multiple></label>
    <label class="chip" id="dchip"><span id="dlabel">오늘</span><input id="date" type="date"></label>
  </div>
  <div class="thumbs" id="thumbs"></div>
  <textarea id="text" placeholder="오늘 게임 어땠어요? 몇 마디 남겨보세요"></textarea>
  ` : `
  <div class="stars" id="stars"></div>
  <textarea id="text" placeholder="리뷰를 남겨보세요...">${esc(item.review)}</textarea>
  `}
  <button class="save" id="save">${isDiary ? '기록' : '저장'}</button>
</div>
<div class="done" id="done"><div class="big">✓</div><p>저장했어요</p><small>아래로 쓸어내려 닫아주세요</small></div>
<script>
var MODE=${JSON.stringify(mode)};
var photos=[];var MAX=4;
function today(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function compress(file,budget){return new Promise(function(res,rej){var u=URL.createObjectURL(file);var img=new Image();img.onload=function(){var lv=[[1440,.82],[1280,.78],[1080,.72],[900,.66],[720,.6],[560,.55]];var out=null;for(var i=0;i<lv.length;i++){var s=Math.min(1,lv[i][0]/Math.max(img.naturalWidth,img.naturalHeight));var c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*s);c.height=Math.round(img.naturalHeight*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);out=c.toDataURL('image/jpeg',lv[i][1]);if(out.length<=budget)break;}URL.revokeObjectURL(u);res(out);};img.onerror=function(){rej(new Error('사진을 읽지 못했어요'));};img.src=u;});}
if(MODE==='diary'){
  var dateEl=document.getElementById('date');dateEl.value=today();dateEl.max=today();
  dateEl.onchange=function(){if(!dateEl.value)dateEl.value=today();var on=dateEl.value!==today();document.getElementById('dchip').className='chip'+(on?' on':'');var p=dateEl.value.split('-');document.getElementById('dlabel').textContent=on?(+p[1])+'월 '+(+p[2])+'일':'오늘';};
  var files=[];
  function draw(){var t=document.getElementById('thumbs');t.innerHTML='';files.forEach(function(f,i){var d=document.createElement('div');d.className='th';d.innerHTML='<img src="'+f.url+'"><b>×</b>';d.querySelector('b').onclick=function(){files.splice(i,1);draw();};t.appendChild(d);});document.getElementById('pbtn').firstChild.textContent=files.length?'📷 '+files.length+'/'+MAX:'📷 사진';}
  document.getElementById('file').onchange=function(e){var add=[].slice.call(e.target.files||[]);e.target.value='';add.slice(0,MAX-files.length).forEach(function(f){files.push({file:f,url:URL.createObjectURL(f)});});draw();};
} else {
  var rating=${item.rating || 0};
  function stars(){var s=document.getElementById('stars');s.innerHTML='';for(var n=1;n<=5;n++){(function(n){var e=document.createElement('span');e.textContent='★';e.className=rating>=n?'f':(rating>=n-.5?'h':'');e.onclick=function(ev){var half=ev.offsetX<e.offsetWidth/2;var v=half?n-.5:n;rating=(rating===v)?0:v;stars();};s.appendChild(e);})(n);}}
  stars();
}
var ta=document.getElementById('text');setTimeout(function(){ta.focus();},350);
window.__result='';
function failSave(msg){alert(msg);var b=document.getElementById('save');b.disabled=false;b.textContent='다시 시도';}
function finish(){document.getElementById('form').style.display='none';document.getElementById('done').style.display='block';}
document.getElementById('save').onclick=function(){
  var b=this;var text=ta.value.trim();
  if(MODE==='diary'&&!text&&!files.length)return;
  b.disabled=true;b.textContent='저장 중…';
  var job=MODE==='diary'
    ? (function(){var budget=Math.floor((900000-text.length*3)/Math.max(1,files.length));return files.reduce(function(p,f){return p.then(function(){return compress(f.file,budget).then(function(x){photos.push(x);});});},Promise.resolve()).then(function(){return {text:text,date:dateEl.value||today(),photos:photos};});})()
    : Promise.resolve({review:ta.value,rating:rating});
  job.then(function(v){window.__result=JSON.stringify(v);},function(err){failSave(err.message);});
};
</script></body></html>`;
}

async function openSheet(mode, itemId) {
  const auth = await getAuth();
  if (!auth) return;
  let item;
  try { item = await getItem(auth, itemId); } catch (e) {
    const a = new Alert(); a.title = '불러오지 못했어요'; a.message = String(e.message || e); a.addAction('확인'); await a.presentAlert();
    return;
  }
  const wv = new WebView();
  await wv.loadHTML(sheetHTML(mode, item));
  let isClosed = false;
  const closed = wv.present(false).then(() => { isClosed = true; });
  const sleep = ms => new Promise(r => Timer.schedule(ms, false, r));
  // 저장 버튼이 눌릴 때까지 0.4초마다 확인 (창을 닫으면 끝). 평가식은 항상 문자열을 돌려줌.
  const READ = "(function(){var r=window.__result||'';window.__result='';return String(r);})()";
  while (!isClosed) {
    await sleep(400);
    if (isClosed) break;
    let raw = '';
    try { raw = await wv.evaluateJavaScript(READ); } catch (e) { raw = ''; }
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      if (mode === 'diary') await saveDiary(auth, item.id, data);
      else await saveReview(auth, item.id, data);
      await wv.evaluateJavaScript("finish(); 'ok'");
    } catch (e) {
      const msg = JSON.stringify('저장 실패: ' + (e.message || e));
      try { await wv.evaluateJavaScript(`failSave(${msg}); 'ok'`); } catch (e2) { /* ignore */ }
    }
  }
  await closed;
}

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
    addButton(right, t.emoji, label, runLink(t.go, b.item.id), i === 0);
    if (i < buttons.length - 1) right.addSpacer(6);
  });

  return w;
}

/* ── 실행 ── */
async function run() {
  // 위젯 버튼으로 실행된 경우: 바로 쓰기 창
  const q = args.queryParameters || {};
  if (config.runsInApp && (q.action === 'diary' || q.action === 'review') && q.item) {
    await openSheet(q.action, q.item);
    Script.complete();
    return;
  }

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
