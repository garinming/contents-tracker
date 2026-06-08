import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { CUSTOM_FONTS } from './customFonts';
import { Calendar, Tag, Star, Repeat2, Film, PenLine, MessageSquare, Circle } from 'lucide-react';
import { auth, db, storage } from './firebase';
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as fbSignOut, sendPasswordResetEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, where, getDoc, setDoc, getDocs, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import './App.css';

const UserCtx = React.createContext({ uid:'', logout:()=>{} });

const TYPES = {
  game:  { name: 'Games',   emoji: '🎮' },
  video: { name: 'Watches', emoji: '🎬' },
  book:  { name: 'Books',   emoji: '📚' },
  novel: { name: 'Novel',   emoji: '📖' },
  comic: { name: 'Comic',   emoji: '📔' },
};
const STATUS = {
  game:  { want: 'want', ing: 'ing', yet: 'yet', done: 'done' },
  video: { want: 'want', ing: 'ing', yet: 'yet', done: 'done' },
  book:  { want: 'want', ing: 'ing', yet: 'yet', done: 'done' },
  novel: { want: 'want', ing: 'ing', yet: 'yet', done: 'done' },
  comic: { want: 'want', ing: 'ing', yet: 'yet', done: 'done' },
};
const STATUS_ORDER  = ['ing', 'yet', 'done', 'want'];
const ACCENT_COLORS = [
  '#FF6B9D','#4A90E2','#9B59B6','#27AE60','#F5A623','#FF6B6B'
];
const TAG_COLORS = ['#FF6B9D','#4A90E2','#9B59B6','#27AE60','#F5A623','#FF6B6B','#00BCD4','#AEAEB2'];
const EVENT_COLORS = ['#FF6B9D','#4A90E2','#FF9F43','#27AE60','#9B59B6','#FF6B6B'];
const FONTS = [
  { name: '기본',          value: 'system',     family: `-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif` },
  { name: 'Pretendard',    value: 'pretendard', family: `'Pretendard',sans-serif` },
  { name: 'Noto Sans KR',  value: 'noto',       family: `'Noto Sans KR',sans-serif` },
  { name: '나눔고딕',       value: 'nanum',      family: `'Nanum Gothic',sans-serif` },
];
const ALL_FONTS = [...FONTS, ...(CUSTOM_FONTS||[])];

const API_KEYS = {
  aladin: 'ttbths030131740001',
  tmdb:   'c9212fa32cdb07c07f52fbbef175958f',
  rawg:   '412e491c359b4da9b93a8cc7dc7c386d'
};

function toMs(val) {
  if (!val) return null;
  if (val.seconds) return val.seconds * 1000;
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'string') return new Date(val).getTime();
  return null;
}
function toDateStr(val) {
  const ms = toMs(val);
  if (!ms) return '';
  return new Date(ms).toISOString().split('T')[0];
}
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
function compressCoverImage(file) {
  if (!file.type?.startsWith('image/') || file.type === 'image/gif') return Promise.resolve(file);
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxSide = 1400;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(file);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        if (!blob) return resolve(file);
        const name = file.name.replace(/\.[^.]+$/, '') || 'cover';
        resolve(new File([blob], `${name}.jpg`, { type:'image/jpeg' }));
      }, 'image/jpeg', 0.86);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}
function setAccentVars(hex) {
  const r = parseInt(hex.slice(1,3),16)||0;
  const g = parseInt(hex.slice(3,5),16)||0;
  const b = parseInt(hex.slice(5,7),16)||0;
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-t10', `rgba(${r},${g},${b},0.10)`);
  document.documentElement.style.setProperty('--accent-t20', `rgba(${r},${g},${b},0.20)`);
  document.documentElement.style.setProperty('--accent-t40', `rgba(${r},${g},${b},0.40)`);
}

async function searchAPI(query, type) {
  try {
    if (type === 'game') {
      const res = await fetch(`https://api.rawg.io/api/games?key=${API_KEYS.rawg}&search=${encodeURIComponent(query)}&page_size=5`);
      const data = await res.json();
      return (data.results||[]).map(i=>({ title:i.name, cover:i.background_image, year:i.released?.substring(0,4), genre:i.genres?.[0]?.name }));
    }
    if (type === 'video') {
      const res = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${API_KEYS.tmdb}&query=${encodeURIComponent(query)}&language=ko`);
      const data = await res.json();
      return (data.results||[]).filter(i=>i.media_type==='movie'||i.media_type==='tv').slice(0,5).map(i=>({
        title: i.title||i.name,
        cover: i.poster_path?`https://image.tmdb.org/t/p/w500${i.poster_path}`:null,
        year:  (i.release_date||i.first_air_date)?.substring(0,4)
      }));
    }
    if (type==='book'||type==='comic'||type==='novel') {
      const rawUrl = `https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?ttbkey=${API_KEYS.aladin}&Query=${encodeURIComponent(query)}&QueryType=Title&MaxResults=5&start=1&SearchTarget=Book&Cover=Big&output=js&Version=20131101`;
      const proxyUrls = [
        `https://corsproxy.io/?${encodeURIComponent(rawUrl)}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(rawUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl)}`
      ];
      const parseBookSearch = async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        const text = new TextDecoder('utf-8').decode(buffer);
        if (!text.trim()) throw new Error('Empty response');
        const trimmed = text.trim();
        const jsonp = trimmed.match(/^[^(]+\(([\s\S]*)\);?$/);
        const parsed = JSON.parse(jsonp ? jsonp[1] : trimmed);
        if (parsed.errorCode) throw new Error(parsed.errorMessage || `Aladin error ${parsed.errorCode}`);
        return parsed;
      };
      const data = await Promise.any(
        proxyUrls.map(proxyUrl =>
          fetch(proxyUrl)
            .then(parseBookSearch)
            .catch(err => {
              console.warn('[BookSearch] 프록시 실패:', proxyUrl, err);
              throw err;
            })
        )
      ).catch(err => {
        console.error('[BookSearch] 모든 프록시 실패 또는 데이터 없음', err);
        return null;
      });
      if (!data) {
        return [];
      }
      const items = Array.isArray(data.item) ? data.item : (data.item ? [data.item] : []);
      return items.map(i=>({
        title:  (i.title||'').replace(/ *\([^)]*\) */g,''),
        cover:  i.cover?.replace(/\/cover(sum|200)?\//, '/cover500/') || i.cover,
        author: i.author,
        year:   i.pubDate?.substring(0,4),
        genre:  i.categoryName?.split('>')[1]?.trim()
      }));
    }
    return [];
  } catch(e){ console.error(e); return []; }
}

/* ── LEGACY MIGRATION ── */
async function migrateLegacyItems(uid) {
  const flag = 'migrated_' + uid;
  if (localStorage.getItem(flag)) return;
  try {
    const batch = writeBatch(db);
    const pendingUpdates = [];
    for (const col of ['items','gameEvents','todos']) {
      const sn = await getDocs(collection(db, col));
      for (const d of sn.docs) {
        if (!d.data().userId) pendingUpdates.push({ col, id:d.id });
      }
    }
    pendingUpdates.forEach(({col,id}) => batch.update(doc(db,col,id), {userId:uid}));
    const count = pendingUpdates.length;
    if (count > 0) { await batch.commit(); console.log(`마이그레이션 완료: ${count}개`); }
    else { console.log('마이그레이션: 대상 없음 (이미 완료됐거나 데이터 없음)'); }
    localStorage.setItem(flag, '1');
  } catch(e) {
    console.error('마이그레이션 실패 (Firestore 규칙 확인 필요):', e.code, e.message);
  }
}

/* ── AUTH SCREEN ── */
function AuthScreen() {
  const [isSignup, setIsSignup] = useState(false);
  const [isReset,  setIsReset]  = useState(false);
  const [uname, setUname] = useState('');
  const [pw,    setPw]    = useState('');
  const [email, setEmail] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [ok,  setOk]  = useState('');
  const clr = () => { setErr(''); setOk(''); };

  const doLogin = async () => {
    if (!uname.trim() || !pw) return setErr('아이디와 비밀번호를 입력하세요');
    setLoading(true); clr();
    const n = uname.trim().toLowerCase();
    try {
      // 인증 이메일은 항상 {username}@helo.app — Firestore 조회 없이 바로 로그인
      await signInWithEmailAndPassword(auth, `${n}@helo.app`, pw);
      localStorage.setItem('authUser', n);
    } catch(e) {
      setErr(e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password'
        ? '아이디 또는 비밀번호가 틀렸습니다' : '로그인 실패');
    } finally { setLoading(false); }
  };

  const doSignup = async () => {
    const n = uname.trim().toLowerCase();
    if (!n || !pw) return setErr('아이디와 비밀번호를 입력하세요');
    if (n.length < 2) return setErr('아이디는 2자 이상이어야 합니다');
    if (pw.length < 6) return setErr('비밀번호는 6자 이상이어야 합니다');
    if (email && !/\S+@\S+\.\S+/.test(email)) return setErr('이메일 형식이 올바르지 않습니다');
    setLoading(true); clr();
    try {
      const ex = await getDoc(doc(db,'usernames', n));
      if (ex.exists()) { setErr('이미 사용 중인 아이디입니다'); return; }
      const authEmail = `${n}@helo.app`; // 항상 synthetic email로 인증
      const cred = await createUserWithEmailAndPassword(auth, authEmail, pw);
      await setDoc(doc(db,'usernames', n), {
        uid: cred.user.uid, authEmail,
        resetEmail: email.trim() || null, hasEmail: !!email.trim(), createdAt: new Date()
      });
      localStorage.setItem('authUser', n);
    } catch(e) {
      setErr(e.code==='auth/email-already-in-use' ? '이미 사용 중인 아이디입니다' : '가입 실패: '+e.message);
    } finally { setLoading(false); }
  };

  const doReset = async () => {
    if (!uname.trim()) return setErr('아이디를 입력하세요');
    setLoading(true); clr();
    try {
      const snap = await getDoc(doc(db,'usernames', uname.trim().toLowerCase()));
      if (!snap.exists()) { setErr('존재하지 않는 아이디입니다'); return; }
      const d = snap.data();
      if (!d.hasEmail) { setErr('이메일이 등록되지 않은 계정입니다. 비밀번호를 재설정할 수 없어요.'); return; }
      await sendPasswordResetEmail(auth, d.authEmail);
      setOk('비밀번호 재설정 이메일을 발송했습니다');
    } catch(e) { setErr('실패: '+e.message); }
    finally { setLoading(false); }
  };

  const onKey = (e, fn) => { if(e.key==='Enter') fn(); };

  return (
    <div className="auth-overlay">
      <div className="auth-card">
        <div className="auth-logo">🎬</div>
        <h2 className="auth-title">내 컬렉션</h2>
        <p className="auth-sub">{isReset?'비밀번호 재설정':isSignup?'새 계정 만들기':'로그인'}</p>
        {err && <div className="auth-error">{err}</div>}
        {ok  && <div className="auth-ok">{ok}</div>}

        <div className="auth-field">
          <label className="auth-label">아이디</label>
          <input className="auth-input" value={uname} autoCapitalize="none" autoCorrect="off"
            placeholder="아이디"
            onChange={e=>{setUname(e.target.value);clr();}}
            onKeyPress={e=>onKey(e, isReset?doReset:isSignup?doSignup:doLogin)}/>
        </div>

        {!isReset && (
          <div className="auth-field">
            <label className="auth-label">비밀번호</label>
            <div className="auth-pw-wrap">
              <input className="auth-input" type={showPw?'text':'password'} value={pw}
                placeholder={isSignup?'비밀번호 (6자 이상)':'비밀번호'}
                onChange={e=>{setPw(e.target.value);clr();}}
                onKeyPress={e=>onKey(e, isSignup?doSignup:doLogin)}/>
              <button className="auth-eye" type="button" onClick={()=>setShowPw(v=>!v)}>{showPw?'🙈':'👁'}</button>
            </div>
            {!isSignup && (
              <div className="auth-forgot">
                <button type="button" onClick={()=>{setIsReset(true);clr();}}>비밀번호 찾기</button>
              </div>
            )}
          </div>
        )}

        {isSignup && (
          <div className="auth-field">
            <label className="auth-label">이메일 <span className="auth-optional">(선택 · 비밀번호 찾기에 필요)</span></label>
            <input className="auth-input" type="email" value={email}
              placeholder="이메일 (선택사항)"
              onChange={e=>{setEmail(e.target.value);clr();}}/>
          </div>
        )}

        <button className="auth-btn" disabled={loading}
          onClick={isReset?doReset:isSignup?doSignup:doLogin}>
          {loading?'처리 중…':isReset?'재설정 메일 발송':isSignup?'가입하기':'로그인'}
        </button>

        <div className="auth-switch">
          {isReset ? (
            <button type="button" onClick={()=>{setIsReset(false);clr();}}>← 로그인으로</button>
          ) : isSignup ? (
            <>이미 계정이 있나요?&nbsp;<button type="button" onClick={()=>{setIsSignup(false);clr();}}>로그인</button></>
          ) : (
            <>계정이 없나요?&nbsp;<button type="button" onClick={()=>{setIsSignup(true);clr();}}>회원가입</button></>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [authReady,   setAuthReady]   = useState(false);

  const [view, setView]         = useState('home');
  const [type, setType]         = useState(null);
  const [gameTab, setGameTab]   = useState('main');
  const [items, setItems]       = useState([]);
  const [gameEvents, setGameEvents] = useState([]);
  const [todos, setTodos]       = useState([]);
  const [mode, setMode]         = useState('album');
  const [search, setSearch]     = useState('');
  const [selected, setSelected] = useState(null);
  const [selectedInitTab, setSelectedInitTab] = useState('info');
  const [showAdd, setShowAdd]   = useState(false);
  const [filterTag, setFilterTag] = useState(null);
  const [sortBy, setSortBy]     = useState('date');
  const [sortDir, setSortDir]   = useState('desc');
  const [showMoney, setShowMoney] = useState(false);
  const [dayPicker, setDayPicker] = useState(null);
  const [calPicks, setCalPicks] = useState(() => {
    try { return JSON.parse(localStorage.getItem('calPicks')||'{}'); } catch{ return {}; }
  });
  const [goals, setGoals] = useState(() => {
    try { return JSON.parse(localStorage.getItem('goals')||'{}'); } catch { return {}; }
  });
  const [savedFilters, setSavedFilters] = useState(() => {
    try { return JSON.parse(localStorage.getItem('savedFilters')||'[]'); } catch { return []; }
  });
  const [accentColor, setAccentColor] = useState(()=>localStorage.getItem('accentColor')||'#FF6B9D');
  const [font, setFont]         = useState(()=>localStorage.getItem('font')||'system');
  const [username, setUsername] = useState(()=>localStorage.getItem('username')||'Curator');

  useEffect(()=>{ localStorage.setItem('username', username); },[username]);

  useEffect(()=>{
    const base = process.env.PUBLIC_URL||'';
    const faceCSS = (CUSTOM_FONTS||[]).map(f=>
      `@font-face{font-family:${f.fontFamily};src:url("${base}/fonts/${encodeURIComponent(f.file)}")format("truetype");font-display:swap;}`
    ).join('');
    let faceEl = document.getElementById('custom-font-faces');
    if(!faceEl){faceEl=document.createElement('style');faceEl.id='custom-font-faces';document.head.appendChild(faceEl);}
    faceEl.textContent = faceCSS;
  },[]);

  useEffect(()=>{
    if(view==='home'||view==='cal'){
      document.body.style.overflowY='hidden';
      document.documentElement.style.overflowY='hidden';
    } else {
      document.body.style.overflowY='';
      document.documentElement.style.overflowY='';
    }
  },[view]);

  useEffect(()=>{
    const f = ALL_FONTS.find(x=>x.value===font)||FONTS[0];
    setAccentVars(accentColor);
    document.documentElement.style.setProperty('--font', f.family);
    document.body.style.fontFamily = f.family;
    let styleEl = document.getElementById('font-override');
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id='font-override'; document.head.appendChild(styleEl); }
    const base = process.env.PUBLIC_URL || '';
    let faceDecl = '';
    if (f.value === 'kopubdotum') {
      faceDecl = `@font-face{font-family:'KoPubDotum';src:url('${base}/fonts/KoPubWorld Dotum Medium.ttf') format('truetype');font-weight:100 500;font-display:swap;}@font-face{font-family:'KoPubDotum';src:url('${base}/fonts/KoPubWorld Dotum Bold.ttf') format('truetype');font-weight:600 900;font-display:swap;}`;
    } else if (f.file) {
      faceDecl = `@font-face{font-family:'${f.fontFamily}';src:url('${base}/fonts/${f.file}') format('truetype');font-display:swap;}`;
    }
    styleEl.textContent = `${faceDecl}html,body,body *,input,button,select,textarea,h1,h2,h3,h4,h5,h6,p,span,div{font-family:${f.family}!important;-webkit-font-smoothing:antialiased;}.home-card-icon span,.home-topbar-icon,.stats-type-emoji{font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif!important;}.fab,.fab-plus{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif!important;font-size:28px!important;line-height:1!important;}`;
    localStorage.setItem('accentColor', accentColor);
    localStorage.setItem('font', font);
  },[accentColor,font]);

  useEffect(()=>{
    window.scrollTo(0, 0);
  },[view, type]);

  useEffect(()=>{ localStorage.setItem('calPicks', JSON.stringify(calPicks)); },[calPicks]);
  useEffect(()=>{ localStorage.setItem('goals', JSON.stringify(goals)); },[goals]);
  useEffect(()=>{ localStorage.setItem('savedFilters', JSON.stringify(savedFilters)); },[savedFilters]);

  // Auth state listener
  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, async user => {
      setCurrentUser(user);
      setAuthReady(true);
      if (user) {
        const u = localStorage.getItem('authUser') || '';
        if (u) await migrateLegacyItems(user.uid);
      }
    });
    return unsub;
  },[]);

  // Data listeners — only run when logged in
  useEffect(()=>{
    if (!currentUser) return;
    const uid = currentUser.uid;
    const q1 = query(collection(db,'items'), where('userId','==',uid));
    const u1 = onSnapshot(q1, snap=>{
      const d=[]; snap.forEach(x=>d.push({id:x.id,...x.data()})); setItems(d);
    });
    const q2 = query(collection(db,'gameEvents'), where('userId','==',uid));
    const u2 = onSnapshot(q2, snap=>{
      const d=[]; snap.forEach(x=>d.push({id:x.id,...x.data()})); setGameEvents(d);
    });
    const q3 = query(collection(db,'todos'), where('userId','==',uid));
    const u3 = onSnapshot(q3, snap=>{
      const d=[]; snap.forEach(x=>d.push({id:x.id,...x.data()}));
      setTodos(d.sort((a,b)=>{
        const ad=toMs(a.dueDate), bd=toMs(b.dueDate);
        if(ad&&bd) return ad-bd;
        if(ad) return -1; if(bd) return 1;
        return (toMs(a.createdAt)||0)-(toMs(b.createdAt)||0);
      }));
    });
    return ()=>{ u1(); u2(); u3(); };
  },[currentUser]);

  const filtered = items.filter(item=>{
    if (view==='wishlist') return (item.status||'want')==='want';
    if (!type) return true;
    if (item.type!==type) return false;
    if (filterTag && !item.tags?.includes(filterTag)) return false;
    if (!search) return true;
    return item.title?.toLowerCase().includes(search.toLowerCase());
  });
  const sorted = [...filtered].sort((a,b)=>{
    let av,bv;
    if (sortBy==='rating'){ av=a.rating||0; bv=b.rating||0; }
    else if(sortBy==='title'){ av=a.title?.toLowerCase()||''; bv=b.title?.toLowerCase()||''; }
    else { av=toMs(a.viewDate)||toMs(a.createdAt)||0; bv=toMs(b.viewDate)||toMs(b.createdAt)||0; }
    return sortDir==='asc'?(av>bv?1:-1):(av<bv?1:-1);
  });
  const grouped = sorted.reduce((acc,item)=>{
    const s=item.status||'want'; if(!acc[s])acc[s]=[]; acc[s].push(item); return acc;
  },{});
  const allTags = [...new Set(items.filter(i=>i.type===type).flatMap(i=>i.tags||[]))];
  const totalPrice = filtered.reduce((s,i)=>s+(parseFloat(i.price)||0),0);

  const sortProps = {
    sortBy, sortDir,
    onSort:(by)=>{ if(sortBy===by)setSortDir(d=>d==='asc'?'desc':'asc'); else{setSortBy(by);setSortDir('desc');} }
  };

  const handleLogout = async () => {
    await fbSignOut(auth);
    localStorage.removeItem('authUser');
    setCurrentUser(null);
    setItems([]); setGameEvents([]); setTodos([]);
  };

  if (!authReady) return <div className="auth-overlay"><div className="auth-card" style={{textAlign:'center',padding:40}}>로딩 중…</div></div>;
  if (!currentUser) return <AuthScreen />;

  return (
    <UserCtx.Provider value={{ uid: currentUser.uid, logout: handleLogout }}>
    <div className="app">
      <div className="content">
        {view==='home' && <Home items={items} username={username} goals={goals} onSelect={t=>{ setType(t); setGameTab('main'); setView('cat'); }} />}

        {view==='cat' && type && (
          type==='game' ? (
            <GameView
              items={sorted} groups={grouped} gameEvents={gameEvents} todos={todos}
              gameTab={gameTab} onGameTab={setGameTab}
              mode={mode} search={search} filterTag={filterTag} allTags={allTags}
              totalPrice={totalPrice} showMoney={showMoney}
              onSearch={setSearch} onMode={setMode} onFilterTag={setFilterTag}
              onAdd={()=>setShowAdd(true)} onSelect={setSelected}
              onToggleMoney={()=>setShowMoney(v=>!v)} {...sortProps}
            />
          ) : (
            <Category
              type={type} groups={grouped} mode={mode} search={search}
              filterTag={filterTag} allTags={allTags} totalPrice={totalPrice} showMoney={showMoney}
              onSearch={setSearch} onMode={setMode} onFilterTag={setFilterTag}
              onAdd={()=>setShowAdd(true)} onSelect={setSelected}
              onToggleMoney={()=>setShowMoney(v=>!v)} {...sortProps}
              savedFilters={savedFilters}
              onSaveFilter={f=>setSavedFilters(p=>[...p,f])}
              onDeleteFilter={idx=>setSavedFilters(p=>p.filter((_,i)=>i!==idx))}
            />
          )
        )}

        {view==='wishlist' && <Wishlist items={sorted} onSelect={setSelected} />}

        {view==='cal' && (
          <CalendarView
            items={items} calPicks={calPicks}
            onPickSet={(dateStr,itemId)=>setCalPicks(p=>({...p,[dateStr]:itemId}))}
            onDayPick={setDayPicker}
            onSelect={setSelected}
            onSelectReview={item=>{ setSelectedInitTab('review'); setSelected(item); }}
          />
        )}

        {view==='settings' && (
          <Settings accentColor={accentColor} font={font} username={username}
            onAccentColor={setAccentColor} onFont={setFont} onUsername={setUsername} items={items}
            goals={goals} onGoalSet={(t,v)=>setGoals(g=>({...g,[t]:Number(v)||0}))}
          />
        )}
      </div>

      {view==='cat' && type && (
        <button className="fab" onClick={()=>setShowAdd(true)}><span className="fab-plus">+</span></button>
      )}

      <nav className="tabs">
        <div className="sidebar-brand">내 컬렉션</div>
        {[
          {v:'home',     icon:'🏠', label:'Home'},
          {v:'cat',      icon:'📄', label:'Library'},
          {v:'wishlist', icon:'❤️', label:'Wishlist'},
          {v:'cal',      icon:'📅', label:'Activity'},
          {v:'settings', icon:'⚙️', label:'Setting'},
        ].map(({v,icon,label})=>(
          <button key={v} className={view===v?'active':''} onClick={()=>{
            if(v==='cat' && !type){ setType('game'); setGameTab('main'); }
            setView(v);
          }}>
            <span className="tab-icon-wrap"><span className="tab-icon">{icon}</span></span>
            <span className="tab-label">{label}</span>
          </button>
        ))}
      </nav>

      {showAdd && type && <AddModal type={type} onClose={()=>setShowAdd(false)} />}
      {selected && <DetailModal item={selected} initialTab={selectedInitTab} onClose={()=>{ setSelected(null); setSelectedInitTab('info'); }} allTags={[...new Set(items.filter(i=>i.type===selected.type).flatMap(i=>i.tags||[]))]} />}
      {dayPicker && (
        <DayPickSheet
          items={dayPicker.items} dateStr={dayPicker.dateStr}
          currentPick={calPicks[dayPicker.dateStr]}
          onPick={(itemId)=>{ setCalPicks(p=>({...p,[dayPicker.dateStr]:itemId})); setDayPicker(null); }}
          onClose={()=>setDayPicker(null)}
        />
      )}
    </div>
    </UserCtx.Provider>
  );
}

/* ── HOME ── */
function Home({ items, username, goals, onSelect }) {
  const ingCount = items.filter(i=>i.status==='ing').length;
  const ingByType  = items.reduce((a,i)=>{ if(i.status==='ing')  a[i.type]=(a[i.type]||0)+1; return a; },{});

  const thisYear   = new Date().getFullYear();
  const doneThisYear = items.filter(i=>{
    if(i.status!=='done') return false;
    const ms = toMs(i.endDate)||toMs(i.viewDate);
    return ms && new Date(ms).getFullYear()===thisYear;
  });
  const doneYearByType = doneThisYear.reduce((a,i)=>{ a[i.type]=(a[i.type]||0)+1; return a; },{});

  return (
    <div className="home">
      <div className="home-header">
        <p className="home-header-lbl"><span className="home-topbar-icon">❤️</span></p>
        <h1 className="home-hello">Hello, {username}</h1>
        <p className="home-sub">You have <strong>{ingCount}</strong> item{ingCount!==1?'s':''} in progress this week.</p>
      </div>
      <div className="home-grid">
        {Object.entries(TYPES).map(([key,val])=>{
          const active = ingByType[key]||0;
          const done   = doneYearByType[key]||0;
          const goal   = goals[key]||0;
          const pct    = goal>0 ? Math.min(100, Math.round(done/goal*100)) : 0;
          return (
            <button key={key} className="home-card" onClick={()=>onSelect(key)}>
              <div className="home-card-top">
                {goal>0 ? (
                  <div className="home-card-ring"
                    style={{background:`conic-gradient(var(--accent) ${pct}%, var(--border) 0%)`}}>
                    <div className="home-card-icon"><span>{val.emoji}</span></div>
                  </div>
                ) : (
                  <div className="home-card-icon"><span>{val.emoji}</span></div>
                )}
                <div className="home-card-goal-badge" style={{visibility: goal>0 ? 'visible' : 'hidden'}}>
                  <span className="hg-num">{done}</span>
                  <span className="hg-sep">/</span>
                  <span className="hg-total">{goal}</span>
                </div>
              </div>
              <div className="home-card-body">
                <span className="home-card-name">{val.name}</span>
                <div className="home-card-foot">
                  <span className="home-card-active">{active} active</span>
                  <span className="home-card-arrow">→</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── GAME VIEW ── */
function GameView({ items, groups, gameEvents, todos, gameTab, onGameTab, mode, search, filterTag, allTags, totalPrice, showMoney, onSearch, onMode, onFilterTag, onSort, sortBy, sortDir, onAdd, onSelect, onToggleMoney }) {
  const [libStatus, setLibStatus] = useState('ing');
  const [searchOpen, setSearchOpen] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [viewMode, setViewMode] = useState('gallery');
  const searchRef = useRef(null);
  const allItems = STATUS_ORDER.flatMap(s=>groups[s]||[]);
  const displayItems = libStatus==='all' ? allItems : (groups[libStatus]||[]);

  return (
    <div className="game-view">
      <div className="lib-sticky-header">
        {gameTab==='main' ? (
          <div className="lib-header">
            <div className="lib-header-row">
              <div>
                <p className="lib-collection-lbl">GAMES</p>
                <h2 className="lib-title">Calendar</h2>
                <div className="lib-sub-spacer"/>
              </div>
            </div>
          </div>
        ) : (
          <div className="lib-header">
            <div className="lib-header-row">
              <div>
                <p className="lib-collection-lbl">COLLECTION</p>
                <h2 className="lib-title">{TYPES.game.name} Gallery</h2>
                <div className="lib-sub-spacer"/>
              </div>
              <button className="lib-search-btn" onClick={()=>{
                if(searchOpen){ onSearch(''); setSearchOpen(false); }
                else { setSearchOpen(true); setTimeout(()=>searchRef.current?.focus(),50); }
              }}>{searchOpen?'✕':'🔍'}</button>
            </div>
            {searchOpen && (
              <div className="lib-search-row">
                <input ref={searchRef} type="search" placeholder="Search..." value={search}
                  onChange={e=>onSearch(e.target.value)} className="lib-search-input"/>
              </div>
            )}
          </div>
        )}
        <div className="seg-ctrl">
          <button className={gameTab==='main'?'active':''} onClick={()=>onGameTab('main')}>캘린더</button>
          <button className={gameTab==='lib'?'active':''} onClick={()=>onGameTab('lib')}>라이브러리</button>
        </div>
      </div>
      {gameTab==='lib' && (
        <div className="lib-tabs-bar">
          <div className="lib-tabs-row1">
            <div className="lib-tabs">
              {['all',...STATUS_ORDER].map(s=>(
                <button key={s} className={`lib-tab-btn${libStatus===s?' active':''}`}
                  onClick={()=>setLibStatus(s)}>
                  {s==='all'?'All':s.charAt(0).toUpperCase()+s.slice(1)}
                </button>
              ))}
            </div>
            <button className="lib-filter-icon" onClick={()=>setShowFilter(v=>!v)}>⚙️</button>
          </div>
          <div className="lib-tabs-row2">
            <div className="lib-view-toggle">
              <button className={`lib-view-btn${viewMode==='gallery'?' active':''}`} onClick={()=>setViewMode('gallery')}><span className="vbtn-icon">⊞</span> 갤러리</button>
              <button className={`lib-view-btn${viewMode==='list'?' active':''}`} onClick={()=>setViewMode('list')}><span className="vbtn-icon">☰</span> 목록</button>
            </div>
          </div>
        </div>
      )}

      {gameTab==='main' && (
        <>
          <GameCalendar gameEvents={gameEvents} />
          <div className="section-title">투두리스트</div>
          <GameTodo todos={todos} />
        </>
      )}

      {gameTab==='lib' && (
        <>
          {showFilter && (
            <div className="lib-filter-sheet">
              <div className="sort-bar">
                {[['date','날짜순'],['rating','별점순'],['title','ㄱㄴㄷ순']].map(([v,l])=>(
                  <button key={v} className={`sort-chip${sortBy===v?' active':''}`} onClick={()=>onSort(v)}>
                    {l}{sortBy===v?(sortDir==='desc'?' ↓':' ↑'):''}
                  </button>
                ))}
              </div>
              {allTags.length>0 && (
                <div className="tag-filter">
                  <button className={!filterTag?'active':''} onClick={()=>onFilterTag(null)}>전체</button>
                  {allTags.map(t=>(
                    <button key={t} className={filterTag===t?'active':''} onClick={()=>onFilterTag(t)}>#{t}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {showMoney && <div className="money-banner">💰 총 지출: {totalPrice.toLocaleString()}원</div>}
          {viewMode==='gallery' ? (
            <div className="status-grid">
              {displayItems.length===0
                ? <div className="lib-empty">No items with this status</div>
                : displayItems.map(i=><StatusCard key={i.id} item={i} onClick={()=>onSelect(i)}/>)
              }
            </div>
          ) : (
            <LibListView items={displayItems} type="game" onSelect={onSelect}/>
          )}
        </>
      )}
    </div>
  );
}

/* ── GAME CALENDAR (Apple Calendar style) ── */
function GameCalendar({ gameEvents }) {
  const [month, setMonth]         = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [showAdd, setShowAdd]     = useState(false);
  const [editEvent, setEditEvent] = useState(null);
  const today = new Date(); today.setHours(0,0,0,0);

  const year=month.getFullYear(), m=month.getMonth();
  const firstDay = new Date(year,m,1).getDay();
  const daysInMonth = new Date(year,m+1,0).getDate();

  const allDays = [];
  for(let i=0;i<firstDay;i++) allDays.push(null);
  for(let d=1;d<=daysInMonth;d++) allDays.push(new Date(year,m,d));
  while(allDays.length%7!==0) allDays.push(null);

  const weeks=[];
  for(let i=0;i<allDays.length;i+=7) weeks.push(allDays.slice(i,i+7));

  const normEvents = gameEvents.map(ev=>{
    const s = ev.startDate ? new Date(toMs(ev.startDate)) : ev.date ? new Date(toMs(ev.date)) : null;
    if(!s) return null;
    s.setHours(0,0,0,0);
    const e = ev.endDate ? new Date(toMs(ev.endDate)) : new Date(s);
    e.setHours(0,0,0,0);
    return {...ev, ns:s, ne:e};
  }).filter(Boolean);

  const selectedEvents = selectedDate
    ? normEvents.filter(ev=>ev.ns<=selectedDate && ev.ne>=selectedDate)
    : [];

  return (
    <div className="gcal px20">
      <div className="cal-nav-row">
        <button className="cal-nav-arrow" onClick={()=>setMonth(new Date(year,m-1))}>‹</button>
        <h2 className="cal-nav-title">{year}년 {m+1}월</h2>
        <button className="cal-nav-arrow" onClick={()=>setMonth(new Date(year,m+1))}>›</button>
      </div>
      <div className="gcal-wrap">
        <div className="gcal-header">
          {['일','월','화','수','목','금','토'].map(d=><div key={d} className="weekday">{d}</div>)}
        </div>
        {weeks.map((week,wi)=>(
          <WeekRow key={wi} week={week} events={normEvents} today={today}
            selected={selectedDate} onDayClick={d=>{setSelectedDate(prev=>prev?.toDateString()===d.toDateString()?null:d);}} />
        ))}
      </div>

      {selectedDate && (
        <div className="event-panel">
          <div className="event-panel-hd">
            <span>{selectedDate.toLocaleDateString('ko-KR',{month:'long',day:'numeric'})}</span>
            <button className="btn-primary-sm" onClick={()=>setShowAdd(true)}>+ 이벤트</button>
          </div>
          {selectedEvents.length===0 && <p className="event-empty">이벤트 없음</p>}
          {selectedEvents.map(ev=>(
            <div key={ev.id} className="event-item" onClick={()=>setEditEvent(ev)}>
              <span className="ev-dot" style={{background:ev.color||'var(--accent)'}} />
              <div className="ev-info">
                <strong>{ev.title}</strong>
                <p>{ev.ns.toLocaleDateString('ko-KR')} {ev.ns.toDateString()!==ev.ne.toDateString()&&`~ ${ev.ne.toLocaleDateString('ko-KR')}`}</p>
                {ev.description && <p className="ev-desc">{ev.description}</p>}
              </div>
              <button className="ev-del" onClick={async e=>{ e.stopPropagation(); await deleteDoc(doc(db,'gameEvents',ev.id)); }}>×</button>
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddEventModal date={selectedDate} onClose={()=>setShowAdd(false)} />}
      {editEvent && <AddEventModal event={editEvent} date={null} onClose={()=>setEditEvent(null)} />}
    </div>
  );
}

function WeekRow({ week, events, today, selected, onDayClick }) {
  const weekDates = week.filter(Boolean);
  if(!weekDates.length) return null;

  const wStart = new Date(weekDates[0]); wStart.setHours(0,0,0,0);
  const wEnd   = new Date(week[6]||weekDates[weekDates.length-1]); wEnd.setHours(23,59,59,999);

  const bars = events
    .filter(ev=>ev.ns<=wEnd && ev.ne>=wStart)
    .map(ev=>{
      let sc = week.findIndex(d=>d && d>=ev.ns);
      if(sc===-1) sc=0;
      let ec=-1;
      for(let i=6;i>=0;i--){ if(week[i] && week[i]<=ev.ne){ ec=i; break; } }
      if(ec===-1) ec=week.reduce((bi,d,i)=>d?i:bi,0);
      return { ev, sc, ec, isStart:ev.ns>=wStart, isEnd:ev.ne<=wEnd };
    });

  // Assign lanes
  const sorted=[...bars].sort((a,b)=>a.sc-b.sc);
  const laneEnds=[];
  sorted.forEach(bar=>{
    let lane=laneEnds.findIndex(e=>e<bar.sc);
    if(lane===-1){ lane=laneEnds.length; laneEnds.push(bar.ec); }
    else laneEnds[lane]=bar.ec;
    bar.lane=lane;
  });

  return (
    <div className="week-row">
      <div className="week-days">
        {week.map((day,i)=>{
          const isToday = day && day.toDateString()===today.toDateString();
          const isSel   = day && selected && day.toDateString()===selected.toDateString();
          return (
            <div key={i} className={`gcal-cell${!day?' empty':''}${isToday?' today':''}${isSel?' selected':''}`}
              onClick={()=>day&&onDayClick(day)}>
              {day && <span className="gcal-num">{day.getDate()}</span>}
            </div>
          );
        })}
      </div>
      {sorted.length>0 && (
        <div className="week-events" style={{'--lanes':laneEnds.length}}>
          {sorted.map((bar,i)=>{
            const borderRadius =
              bar.isStart && bar.isEnd ? '10px' :
              bar.isStart ? '10px 0 0 10px' :
              bar.isEnd   ? '0 10px 10px 0' : '0';
            return (
              <div key={i} className="ev-bar"
                style={{
                  gridColumn:`${bar.sc+1}/${bar.ec+2}`,
                  gridRow:`${bar.lane+1}`,
                  background: bar.ev.color||'var(--accent)',
                  borderRadius,
                  marginLeft: bar.isStart?'2px':'0',
                  marginRight: bar.isEnd?'2px':'0',
                }}>
                {bar.isStart && <span className="ev-bar-title">{bar.ev.title}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AddEventModal({ event, date, onClose }) {
  const { uid } = React.useContext(UserCtx);
  const [title, setTitle]   = useState(event?.title||'');
  const [desc, setDesc]     = useState(event?.description||'');
  const [color, setColor]   = useState(event?.color||EVENT_COLORS[0]);
  const [startDate, setSD]  = useState(
    event ? toDateStr(event.startDate||event.date) : (date?date.toISOString().split('T')[0]:'')
  );
  const [endDate, setED]    = useState(
    event ? toDateStr(event.endDate||event.startDate||event.date) : (date?date.toISOString().split('T')[0]:'')
  );

  const submit = async () => {
    if(!title.trim()) return;
    const payload = {
      title, description:desc, color,
      startDate: startDate ? new Date(startDate) : new Date(),
      endDate:   endDate   ? new Date(endDate)   : new Date(startDate||Date.now()),
    };
    if(event) await updateDoc(doc(db,'gameEvents',event.id), payload);
    else await addDoc(collection(db,'gameEvents'), {...payload, createdAt:new Date(), userId:uid});
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <h2>{event?'이벤트 수정':'이벤트 추가'}</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <label>이벤트명</label>
          <input type="text" value={title} onChange={e=>setTitle(e.target.value)} placeholder="이벤트 제목" />
          <label>시작 날짜</label>
          <input type="date" value={startDate} onChange={e=>{ setSD(e.target.value); if(!endDate) setED(e.target.value); }} />
          <label>종료 날짜</label>
          <input type="date" value={endDate} min={startDate} onChange={e=>setED(e.target.value)} />
          <label>내용</label>
          <textarea value={desc} onChange={e=>setDesc(e.target.value)} rows="2" placeholder="내용 (선택)" />
          <label>색상</label>
          <div className="color-grid">
            {EVENT_COLORS.map(c=>(
              <button key={c} className={`color-swatch${color===c?' active':''}`} style={{background:c}} onClick={()=>setColor(c)}>
                {color===c&&<span className="check">✓</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <div/>
          <div>
            <button onClick={onClose} className="btn-ghost">취소</button>
            <button onClick={submit} className="btn-primary">저장</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── GAME TODO ── */
function GameTodo({ todos }) {
  const { uid } = React.useContext(UserCtx);
  const [input, setInput]         = useState('');
  const [pendingText, setPending] = useState(null);
  const [dueDate, setDueDate]     = useState('');

  const handleAdd = () => {
    const text = input.trim();
    if(!text) return;
    setPending(text); setInput('');
  };

  const confirmAdd = async (skip) => {
    try {
      await addDoc(collection(db,'todos'), {
        text: pendingText, done:false, createdAt:new Date(),
        dueDate: (!skip && dueDate) ? new Date(dueDate) : null, userId:uid,
      });
      setPending(null); setDueDate('');
    } catch(e) { alert('추가 실패: '+e.message); }
  };

  const toggle = async(t)=> await updateDoc(doc(db,'todos',t.id),{done:!t.done});
  const remove = async(id)=> await deleteDoc(doc(db,'todos',id));

  const pending = todos.filter(t=>!t.done);
  const done    = todos.filter(t=>t.done);

  return (
    <div className="todo-wrap px20">
      <div className="todo-row">
        <input className="todo-input" type="text" placeholder="할 일 추가" value={input}
          onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleAdd()} />
        <button className="btn-primary-sm" onClick={handleAdd}>추가</button>
      </div>
      {todos.length===0 && <p className="todo-empty">할 일이 없어요 ✨</p>}
      <div className="todo-list">
        {pending.map(t=><TodoItem key={t.id} todo={t} onToggle={toggle} onDelete={remove}/>)}
        {done.length>0&&<>
          <p className="todo-done-label">완료 {done.length}개</p>
          {done.map(t=><TodoItem key={t.id} todo={t} onToggle={toggle} onDelete={remove}/>)}
        </>}
      </div>

      {pendingText && (
        <div className="todo-prompt-overlay" onClick={()=>confirmAdd(true)}>
          <div className="todo-prompt" onClick={e=>e.stopPropagation()}>
            <p className="todo-prompt-task">"{pendingText}"</p>
            <p className="todo-prompt-label">날짜를 선택하세요 (선택사항)</p>
            <input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} className="todo-date-input"/>
            <div className="todo-prompt-btns">
              <button className="btn-ghost" onClick={()=>confirmAdd(true)}>건너뛰기</button>
              <button className="btn-primary" onClick={()=>confirmAdd(false)}>확인</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function TodoItem({ todo, onToggle, onDelete }) {
  const dueMs   = toMs(todo.dueDate);
  const today   = new Date(); today.setHours(0,0,0,0);
  const isUrgent = dueMs && dueMs < today.getTime() + 86400000*3 && !todo.done;
  const dueStr  = dueMs ? new Date(dueMs).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric'}) : null;
  return (
    <div className={`todo-item${todo.done?' done':''}${isUrgent?' urgent':''}`}>
      <button className="todo-check" onClick={()=>onToggle(todo)}>{todo.done&&'✓'}</button>
      <div className="todo-body">
        <span className="todo-text">{todo.text}</span>
        {dueStr && <span className={`todo-due${isUrgent?' todo-due-urgent':''}`}>{dueStr}</span>}
      </div>
      <button className="todo-del" onClick={()=>onDelete(todo.id)}>×</button>
    </div>
  );
}

/* ── CATEGORY ── */
function Category({ type, groups, mode, search, filterTag, allTags, sortBy, sortDir, totalPrice, showMoney, onSearch, onMode, onFilterTag, onSort, onAdd, onSelect, onToggleMoney, savedFilters, onSaveFilter, onDeleteFilter }) {
  const [libStatus, setLibStatus] = useState('ing');
  const [searchOpen, setSearchOpen] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [viewMode, setViewMode] = useState('gallery');
  const searchRef = useRef(null);
  const allItems = STATUS_ORDER.flatMap(s=>groups[s]||[]);
  const displayItems = libStatus==='all' ? allItems : (groups[libStatus]||[]);

  return (
    <div className="category">
      <div className="lib-sticky-header">
        <div className="lib-header">
          <div className="lib-header-row">
            <div>
              <p className="lib-collection-lbl">COLLECTION</p>
              <h2 className="lib-title">{TYPES[type].name} Gallery</h2>
              <div className="lib-sub-spacer"/>
            </div>
            <button className="lib-search-btn" onClick={()=>{
              if(searchOpen){ onSearch(''); setSearchOpen(false); }
              else { setSearchOpen(true); setTimeout(()=>searchRef.current?.focus(),50); }
            }}>{searchOpen?'✕':'🔍'}</button>
          </div>
          {searchOpen && (
            <div className="lib-search-row">
              <input ref={searchRef} type="search" placeholder="Search..." value={search}
                onChange={e=>onSearch(e.target.value)} className="lib-search-input"/>
            </div>
          )}
        </div>
      </div>

      <div className="lib-tabs-bar">
        <div className="lib-tabs-row1">
          <div className="lib-tabs">
            {['all',...STATUS_ORDER].map(s=>(
              <button key={s} className={`lib-tab-btn${libStatus===s?' active':''}`}
                onClick={()=>setLibStatus(s)}>
                {s==='all'?'All':s.charAt(0).toUpperCase()+s.slice(1)}
              </button>
            ))}
          </div>
          <button className="lib-filter-icon" onClick={()=>setShowFilter(v=>!v)}>⚙️</button>
        </div>
        <div className="lib-tabs-row2">
          <div className="lib-view-toggle">
            <button className={`lib-view-btn${viewMode==='gallery'?' active':''}`} onClick={()=>setViewMode('gallery')}><span className="vbtn-icon">⊞</span> 갤러리</button>
            <button className={`lib-view-btn${viewMode==='list'?' active':''}`} onClick={()=>setViewMode('list')}><span className="vbtn-icon">☰</span> 목록</button>
          </div>
        </div>
      </div>

      {showFilter && (
        <div className="lib-filter-sheet">
          <div className="sort-bar">
            {[['date','날짜순'],['rating','별점순'],['title','ㄱㄴㄷ순']].map(([v,l])=>(
              <button key={v} className={`sort-chip${sortBy===v?' active':''}`} onClick={()=>onSort(v)}>
                {l}{sortBy===v?(sortDir==='desc'?' ↓':' ↑'):''}
              </button>
            ))}
          </div>
          {allTags.length>0 && (
            <div className="tag-filter">
              <button className={!filterTag?'active':''} onClick={()=>onFilterTag(null)}>전체</button>
              {allTags.map(t=>(
                <button key={t} className={filterTag===t?'active':''} onClick={()=>onFilterTag(t)}>#{t}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {showMoney && <div className="money-banner">💰 총 지출: {totalPrice.toLocaleString()}원</div>}

      {viewMode==='gallery' ? (
        <div className="status-grid">
          {displayItems.length===0
            ? <div className="lib-empty">No items with this status</div>
            : displayItems.map(i=><StatusCard key={i.id} item={i} onClick={()=>onSelect(i)}/>)
          }
        </div>
      ) : (
        <LibListView items={displayItems} type={type} onSelect={onSelect}/>
      )}
    </div>
  );
}

function Card({ item, onClick }) {
  return (
    <div className="card" onClick={onClick}>
      {item.cover
        ? <img src={item.cover} alt={item.title}/>
        : <div className="placeholder">{TYPES[item.type]?.emoji||'📦'}</div>
      }
      <div className="card-info">
        <h4>{item.title}</h4>
        {item.rating>0&&<p className="card-rating">{'⭐'.repeat(item.rating)}</p>}
        {item.tags?.length>0&&<p className="card-tags">{item.tags.map(t=>`#${t}`).join(' ')}</p>}
      </div>
    </div>
  );
}
function StatusCard({ item, onClick }) {
  const pct = item.progressTotal>0 && item.progressCurrent>0
    ? Math.min(100, Math.round(item.progressCurrent/item.progressTotal*100))
    : null;
  return (
    <div className="status-card" onClick={onClick}>
      {item.cover
        ? <img src={item.cover} alt={item.title} className="status-card-img"/>
        : <div className="status-card-img status-card-ph">{TYPES[item.type]?.emoji||'📦'}</div>
      }
      {pct!==null && (
        <div className="status-card-pct-bar">
          <div className="status-card-pct-fill" style={{width:`${pct}%`}}/>
        </div>
      )}
      <div className="status-card-overlay">
        <span className="status-card-title">{item.title}</span>
      </div>
    </div>
  );
}

/* ── LIST VIEW ── */
const REPLAY_LABEL = { game:'플레이 횟수', video:'시청 횟수', book:'회독수', novel:'회독수', comic:'회독수' };

function LibListView({ items, type, onSelect }) {
  if(items.length===0) return <div className="lib-empty">No items with this status</div>;
  return (
    <div className="lib-list-view">
      <div className="lib-list-header">
        <span className="lib-list-head">제목</span>
        <span className="lib-list-head lib-list-head-c">상태</span>
        <span className="lib-list-head lib-list-head-c">별점</span>
        <span className="lib-list-head lib-list-head-r">반복</span>
      </div>
      {items.map(i=>(
        <div key={i.id} className="lib-list-row" onClick={()=>onSelect(i)}>
          <span className="lib-list-title">{i.title}</span>
          <span className="lib-list-col"><span className={`lib-status-badge lib-s-${i.status||'want'}`}>{i.status||'—'}</span></span>
          <span className="lib-list-col">{i.rating>0?<StarDisplay value={i.rating}/>:'—'}</span>
          <span className="lib-list-col" style={{textAlign:'right'}}>{i.replayCount>0?i.replayCount:'—'}</span>
        </div>
      ))}
    </div>
  );
}

function StarDisplay({ value, max=5 }) {
  if (!value || value <= 0) return <span>—</span>;
  return (
    <span className="star-display">
      {Array.from({length: max}, (_, i) => {
        const n = i + 1;
        const isFull = value >= n;
        const isHalf = !isFull && value >= n - 0.5;
        return <span key={n} className={`sd-star${isFull?' full':isHalf?' half':''}`}>★</span>;
      })}
    </span>
  );
}

function StarInput({ value, onChange }) {
  return (
    <div className="star-input">
      {[1,2,3,4,5].map(n=>{
        const isFull = value>=n;
        const isHalf = !isFull && value>=n-0.5;
        return (
          <span key={n} className="star-cell">
            <button className="star-half left" onClick={()=>onChange(value===n-0.5?0:n-0.5)}/>
            <button className="star-half right" onClick={()=>onChange(value===n?0:n)}/>
            <span className={`star-glyph${isFull?' full':isHalf?' half':''}`}>★</span>
          </span>
        );
      })}
    </div>
  );
}

/* ── WISHLIST ── */
function WishGroup({ t, its, onSelect }) {
  const [expanded, setExpanded] = useState(false);
  const show = expanded ? its : its.slice(0,3);
  return (
    <div className="group">
      <div className="group-hd" style={{background:'var(--accent-t10)'}}>
        <span className="group-dot" style={{background:'var(--accent)'}}/>
        <span className="group-lbl">{TYPES[t]?.emoji} {TYPES[t]?.name}</span>
        <span className="group-cnt">{its.length}</span>
      </div>
      <div className="grid">{show.map(i=><Card key={i.id} item={i} onClick={()=>onSelect(i)}/>)}</div>
      {its.length>3 && (
        <button className="wish-toggle" onClick={()=>setExpanded(v=>!v)}>
          {expanded ? '접기 ↑' : `${its.length-3}개 더 보기 ↓`}
        </button>
      )}
    </div>
  );
}
function Wishlist({ items, onSelect }) {
  const byType = items.reduce((a,i)=>{ if(!a[i.type])a[i.type]=[]; a[i.type].push(i); return a; },{});
  return (
    <div className="wishlist-page">
      <div className="wishlist-sticky-hd">
        <p className="lib-collection-lbl">WISHLIST</p>
        <h2 className="lib-title">Wishlist</h2>
      </div>
      {items.length===0
        ? <div className="empty-state"><div className="empty-emoji">⭐</div><p>Wishlist is empty</p></div>
        : Object.entries(byType).map(([t,its])=><WishGroup key={t} t={t} its={its} onSelect={onSelect}/>)
      }
    </div>
  );
}

/* ── CALENDAR (content) ── */
function CalendarView({ items, calPicks, onPickSet, onDayPick, onSelect, onSelectReview }) {
  const [month, setMonth]       = useState(new Date());
  const [showDate, setShowDate] = useState(false);
  const [calTab, setCalTab]     = useState('cal'); // 'cal' | 'stats' | 'reviews'
  const year=month.getFullYear(), m=month.getMonth();
  const firstDay=new Date(year,m,1).getDay();
  const days=new Date(year,m+1,0).getDate();

  const byDate = items.reduce((acc,item)=>{
    const push=d=>{ if(!acc[d])acc[d]=[]; if(!acc[d].find(i=>i.id===item.id))acc[d].push(item); };
    if(item.viewDate)   push(new Date(toMs(item.viewDate)).toDateString());
    if(item.endDate)    push(new Date(toMs(item.endDate)).toDateString());
    if(item.progressDates) item.progressDates.forEach(pd=>push(new Date(toMs(pd)).toDateString()));
    return acc;
  },{});

  const cells=[];
  for(let i=0;i<firstDay;i++) cells.push(<div key={`e${i}`} className="cal-cell empty"/>);
  for(let d=1;d<=days;d++){
    const dateStr = new Date(year,m,d).toDateString();
    const dayItems = byDate[dateStr]||[];
    const pickedId = calPicks[dateStr];
    const show = pickedId ? dayItems.find(i=>i.id===pickedId)||dayItems[0] : dayItems[0];
    const extra = dayItems.length>1 ? dayItems.length-1 : 0;
    cells.push(
      <div key={d} className={`cal-cell${!show?' no-thumb':''}`} onClick={()=>{
        if(dayItems.length>1) onDayPick({items:dayItems, dateStr});
        else if(dayItems.length===1) onPickSet(dateStr, dayItems[0].id);
      }}>
        {show
          ? (show.cover
              ? <img src={show.cover} alt="" className="cal-thumb-full"/>
              : <div className="cal-thumb-full cal-ph-full">{TYPES[show.type]?.emoji}</div>)
          : <span className="cal-day-plain">{d}</span>
        }
        {showDate && show && <span className="cal-day-badge">{d}</span>}
        {extra>0 && <span className="cal-count">+{extra}</span>}
      </div>
    );
  }

  // 월간 통계
  const monthDone = items.filter(i=>{
    if(i.status!=='done') return false;
    const ms = toMs(i.endDate)||toMs(i.viewDate);
    if(!ms) return false;
    const d = new Date(ms);
    return d.getFullYear()===year && d.getMonth()===m;
  });
  const monthDoneByType = monthDone.reduce((a,i)=>{ a[i.type]=(a[i.type]||0)+1; return a; },{});
  const ratedItems = monthDone.filter(i=>i.rating>0);
  const avgRating  = ratedItems.length ? (ratedItems.reduce((s,i)=>s+i.rating,0)/ratedItems.length).toFixed(1) : null;

  // 리뷰 피드 (전체, done + review 있는 것)
  const reviewItems = [...items]
    .filter(i=>{
      if(!i.review?.trim()) return false;
      const dateMs = toMs(i.endDate)||toMs(i.viewDate)||toMs(i.createdAt);
      if(!dateMs) return false;
      const d = new Date(dateMs);
      return d.getFullYear()===year && d.getMonth()===m;
    })
    .sort((a,b)=>(toMs(b.endDate)||toMs(b.viewDate)||toMs(b.createdAt)||0)-(toMs(a.endDate)||toMs(a.viewDate)||toMs(a.createdAt)||0));

  return (
    <div className="cal-page">
      <div className="cal-nav-row">
        <button className="cal-nav-arrow" onClick={()=>setMonth(new Date(year,m-1))}>‹</button>
        <h2 className="cal-nav-title">{year}년 {m+1}월</h2>
        <button className="cal-nav-arrow" onClick={()=>setMonth(new Date(year,m+1))}>›</button>
      </div>

      <div className="cal-tab-bar">
        {[['cal','달력'],['stats','통계'],['reviews','리뷰']].map(([v,l])=>(
          <button key={v} className={`cal-tab-btn${calTab===v?' active':''}`} onClick={()=>setCalTab(v)}>{l}</button>
        ))}
      </div>

      {calTab==='cal' && (
        <div className="cal-icon-row">
          <button className={`cal-icon-btn${showDate?' active':''}`} onClick={()=>setShowDate(v=>!v)}>📅</button>
        </div>
      )}

      {calTab==='cal' && (
        <div className="cal-tab-content">
          <div className="cal-grid-wrap">
            <div className="cal-weekdays">
              {['일','월','화','수','목','금','토'].map(d=><div key={d} className="weekday">{d}</div>)}
            </div>
            <div className="cal-grid-full">{cells}</div>
          </div>
        </div>
      )}

      {calTab==='stats' && (
        <div className="cal-tab-content scrollable">
          <div className="stats-wrap">
            <div className="stats-hero">
              <div className="stats-hero-num">{monthDone.length}</div>
              <div className="stats-hero-label">{m+1}월 완료</div>
              {avgRating && <div className="stats-hero-rating">평균 ★ {avgRating}</div>}
            </div>
            {Object.keys(TYPES).length>0 && (
              <div className="stats-type-list">
                {Object.entries(TYPES).map(([k,v])=>{
                  const cnt=monthDoneByType[k]||0;
                  const max=Math.max(...Object.values(monthDoneByType),1);
                  return (
                    <div key={k} className="stats-type-row">
                      <span className="stats-type-emoji">{v.emoji}</span>
                      <span className="stats-type-name">{v.name}</span>
                      <div className="stats-type-bar-wrap">
                        <div className="stats-type-bar" style={{width:cnt?`${Math.round(cnt/max*100)}%`:'0%'}}/>
                      </div>
                      <span className="stats-type-cnt">{cnt}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {monthDone.length===0 && <p className="stats-empty">이번 달 완료한 항목이 없어요</p>}
          </div>
        </div>
      )}

      {calTab==='reviews' && (
        <div className="cal-tab-content scrollable">
          <div className="review-feed">
            {reviewItems.length===0 && <p className="stats-empty">리뷰가 없어요</p>}
            {reviewItems.map(item=>{
              const dateMs = toMs(item.endDate)||toMs(item.viewDate)||toMs(item.createdAt);
              return (
                <div key={item.id} className="review-card" onClick={()=>onSelectReview&&onSelectReview(item)} style={{cursor:'pointer'}}>
                  {item.cover
                    ? <img src={item.cover} alt="" className="review-thumb"/>
                    : <div className="review-thumb review-thumb-ph">{TYPES[item.type]?.emoji}</div>
                  }
                  <div className="review-body">
                    <div className="review-meta">
                      <span className="review-type">{TYPES[item.type]?.name}</span>
                      {item.rating>0 && <StarDisplay value={item.rating}/>}
                    </div>
                    <p className="review-title">{item.title}</p>
                    <p className="review-text">{item.review}</p>
                    {dateMs && <span className="review-date">{new Date(dateMs).toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'})}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DayPickSheet({ items, dateStr, currentPick, onPick, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <h2>썸네일 선택</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p style={{fontSize:13,color:'var(--text-sub)',marginBottom:12}}>달력에 표시할 썸네일을 선택하세요</p>
          {items.map(item=>(
            <div key={item.id} className={`pick-row${currentPick===item.id?' picked':''}`} onClick={()=>onPick(item.id)}>
              {item.cover
                ? <img src={item.cover} alt="" className="pick-thumb"/>
                : <div className="pick-thumb pick-ph">{TYPES[item.type]?.emoji}</div>
              }
              <div>
                <p className="pick-title">{item.title}</p>
                <p className="pick-sub">{TYPES[item.type]?.name} · {STATUS[item.type]?.[item.status]}</p>
              </div>
              {currentPick===item.id && <span className="pick-check">✓</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── CUSTOM FONT PICKER ── */
function CustomFontPicker({ font, onFont }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="custom-font-section">
      <button className="custom-font-toggle" onClick={()=>setOpen(v=>!v)}>
        커스텀 폰트 <span className="custom-font-arrow">{open?'▴':'▾'}</span>
      </button>
      {open && (
        <div className="font-list custom-font-list">
          {CUSTOM_FONTS.map(f=>(
            <button key={f.value} className={`font-btn${font===f.value?' active':''}`}
              style={{fontFamily:f.family}}
              onClick={()=>{ onFont(f.value); setOpen(false); }}>
              <span className="font-name">{f.name}</span>
              <span className="font-preview">가나다 ABC 123</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── SETTINGS ── */
function Settings({ accentColor, font, username, onAccentColor, onFont, onUsername, items, goals, onGoalSet }) {
  const { uid, logout } = React.useContext(UserCtx);
  const authUsername = localStorage.getItem('authUser') || '';
  const fileRef = useRef();
  const [showPwChange, setShowPwChange] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwErr, setPwErr] = useState('');
  const [pwOk, setPwOk] = useState('');

  const handlePwChange = async () => {
    if (!curPw) return setPwErr('현재 비밀번호를 입력하세요');
    if (newPw.length < 6) return setPwErr('새 비밀번호는 6자 이상이어야 합니다');
    if (newPw !== confirmPw) return setPwErr('새 비밀번호가 일치하지 않습니다');
    setPwLoading(true); setPwErr(''); setPwOk('');
    try {
      const user = auth.currentUser;
      const cred = EmailAuthProvider.credential(user.email, curPw);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, newPw);
      setPwOk('비밀번호가 변경되었습니다');
      setCurPw(''); setNewPw(''); setConfirmPw('');
      setTimeout(() => { setShowPwChange(false); setPwOk(''); }, 2000);
    } catch(e) {
      if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') setPwErr('현재 비밀번호가 틀렸습니다');
      else setPwErr('실패: ' + e.message);
    } finally { setPwLoading(false); }
  };
  const handleExport = () => {
    const rows = items.map(i=>({
      제목:i.title||'', 유형:TYPES[i.type]?.name||'', 상태:STATUS[i.type]?.[i.status]||'',
      별점:i.rating||'', 장르:i.genre||'', 작가감독:i.author||i.director||'',
      가격:i.price||'', 리뷰:i.review||'', 태그:(i.tags||[]).join(', '),
      시작날짜: toDateStr(i.startDate), 완료날짜: toDateStr(i.endDate),
    }));
    const ws=XLSX.utils.json_to_sheet(rows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'컬렉션');
    XLSX.writeFile(wb,'내컬렉션.xlsx');
  };
  const handleImport = async(e)=>{
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=async(evt)=>{
      try {
        const wb=XLSX.read(evt.target.result,{type:'binary'});
        const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        let count=0;
        for(const row of rows){
          if(!row['제목']) continue;
          const typeKey=Object.entries(TYPES).find(([,v])=>v.name===row['유형'])?.[0]||'book';
          const statusKey=Object.entries(STATUS[typeKey]||{}).find(([,v])=>v===row['상태'])?.[0]||'want';
          await addDoc(collection(db,'items'),{
            title:String(row['제목']), type:typeKey, status:statusKey,
            rating:Number(row['별점'])||0, genre:String(row['장르']||''),
            author:String(row['작가감독']||''), director:'', price:String(row['가격']||''),
            review:String(row['리뷰']||''), tags:row['태그']?String(row['태그']).split(',').map(t=>t.trim()).filter(Boolean):[],
            cover:null, notes:[], journal:[], createdAt:new Date(), userId:uid,
          });
          count++;
        }
        alert(`${count}개 가져왔습니다!`);
      } catch(err){ alert('실패: '+err.message); }
      e.target.value='';
    };
    reader.readAsBinaryString(file);
  };
  return (
    <div className="settings-page">
      <h2 className="page-title">설정</h2>
      <div className="setting-card">
        <h3>이름</h3>
        <input type="text" value={username} onChange={e=>onUsername(e.target.value)}
          placeholder="이름을 입력하세요" style={{width:'100%',padding:'12px 14px',border:'1.5px solid var(--border)',borderRadius:'var(--r-sm)',background:'var(--bg)',color:'var(--text)',outline:'none'}}/>
      </div>
      <div className="setting-card">
        <h3>포인트 컬러</h3>
        <div className="color-grid">
          {ACCENT_COLORS.map(c=>(
            <button key={c} className={`color-swatch${accentColor===c?' active':''}`} style={{background:c}} onClick={()=>onAccentColor(c)}>
              {accentColor===c&&<span className="check">✓</span>}
            </button>
          ))}
        </div>
        <div className="custom-color-row">
          <span>직접 선택</span>
          <input type="color" value={accentColor} onChange={e=>onAccentColor(e.target.value)}/>
        </div>
      </div>
      <div className="setting-card">
        <h3>폰트 <span className="setting-note">(무료·상업이용가)</span></h3>
        <div className="font-list">
          {FONTS.map(f=>(
            <button key={f.value} className={`font-btn${font===f.value?' active':''}`} style={{fontFamily:f.family}} onClick={()=>onFont(f.value)}>
              <span className="font-name">{f.name}</span>
              <span className="font-preview">가나다 ABC 123</span>
            </button>
          ))}
        </div>
        {CUSTOM_FONTS&&CUSTOM_FONTS.length>0&&<CustomFontPicker font={font} onFont={onFont}/>}
      </div>
      <div className="setting-card">
        <h3>연간 목표 <span className="setting-note">(올해 완료 목표 수)</span></h3>
        <div className="goal-list">
          {Object.entries(TYPES).map(([k,v])=>(
            <div key={k} className="goal-row">
              <span className="goal-emoji">{v.emoji}</span>
              <span className="goal-name">{v.name}</span>
              <input
                type="number" min="0" max="999"
                value={goals[k]||''}
                placeholder="0"
                className="goal-input"
                onChange={e=>onGoalSet(k,e.target.value)}
              />
              <span className="goal-unit">개</span>
            </div>
          ))}
        </div>
      </div>
      <div className="setting-card">
        <h3>데이터</h3>
        <button className="data-btn" onClick={handleExport}>
          <span>📥</span><div><strong>엑셀로 내보내기</strong><p>전체 컬렉션 .xlsx 저장</p></div>
        </button>
        <button className="data-btn" onClick={()=>fileRef.current.click()}>
          <span>📤</span><div><strong>엑셀에서 가져오기</strong><p>제목·유형·상태·별점·장르 등</p></div>
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleImport} style={{display:'none'}}/>
      </div>
      <div className="setting-card">
        <h3>계정</h3>
        <p style={{fontSize:13,color:'var(--sub)',marginBottom:12}}><b style={{color:'var(--text)'}}>{authUsername}</b> 로 로그인 중</p>
        <button className="data-btn" onClick={()=>{ setShowPwChange(v=>!v); setPwErr(''); setPwOk(''); setCurPw(''); setNewPw(''); setConfirmPw(''); }}>
          <span>🔑</span><div><strong>비밀번호 변경</strong><p>현재 비밀번호 확인 후 새 비밀번호로 변경</p></div>
        </button>
        {showPwChange && (
          <div className="pw-change-form">
            <input className="pw-change-input" type="password" placeholder="현재 비밀번호" value={curPw} onChange={e=>{setCurPw(e.target.value);setPwErr('');setPwOk('');}} />
            <input className="pw-change-input" type="password" placeholder="새 비밀번호 (6자 이상)" value={newPw} onChange={e=>{setNewPw(e.target.value);setPwErr('');setPwOk('');}} />
            <input className="pw-change-input" type="password" placeholder="새 비밀번호 확인" value={confirmPw} onChange={e=>{setConfirmPw(e.target.value);setPwErr('');setPwOk('');}}
              onKeyDown={e=>e.key==='Enter'&&handlePwChange()} />
            {pwErr && <p className="pw-change-err">{pwErr}</p>}
            {pwOk  && <p className="pw-change-ok">{pwOk}</p>}
            <button className="pw-change-btn" onClick={handlePwChange} disabled={pwLoading}>
              {pwLoading ? '변경 중…' : '변경하기'}
            </button>
          </div>
        )}
        <button className="data-btn" onClick={logout} style={{borderColor:'#FF3B30',marginTop:8}}>
          <span>🚪</span><div><strong style={{color:'#FF3B30'}}>로그아웃</strong><p>다른 계정으로 전환하려면 로그아웃하세요</p></div>
        </button>
      </div>
    </div>
  );
}

/* ── ADD MODAL ── */
function AddModal({ type, onClose }) {
  const { uid } = React.useContext(UserCtx);
  const [title, setTitle]     = useState('');
  const [status, setStatus]   = useState('want');
  const [file, setFile]       = useState(null);
  const [preview, setPreview] = useState(null);
  const [searching, setSrch]  = useState(false);
  const [saving, setSaving]   = useState(false);
  const [results, setResults] = useState([]);

  const handleFile=e=>{ const f=e.target.files[0]; if(!f)return; setFile(f); const r=new FileReader(); r.onloadend=()=>setPreview(r.result); r.readAsDataURL(f); };

  const doSearch=async()=>{
    if(!title.trim())return; setSrch(true);
    setResults(await searchAPI(title,type)); setSrch(false);
  };

  const selectResult=async(r)=>{
    setSaving(true);
    // Skip Firebase Storage upload - use URL directly for speed
    await addDoc(collection(db,'items'),{
      title:r.title, type, status, cover:r.cover||null, rating:0,
      genre:r.genre||'', author:r.author||'', director:r.director||'', year:r.year||'',
      review:'', notes:[], journal:[], tags:[], price:'', createdAt:new Date(), userId:uid,
      ...(status==='ing'&&{startDate:new Date()}),
    });
    setSaving(false); onClose();
  };

  const submit=async()=>{
    if(!title.trim()) return alert('제목을 입력하세요');
    setSaving(true);
    let url=null;
    if(file){ const sr=ref(storage,`covers/${Date.now()}_${file.name}`); await uploadBytes(sr,file); url=await getDownloadURL(sr); }
    await addDoc(collection(db,'items'),{
      title, type, status, cover:url, rating:0,
      genre:'', author:'', director:'', review:'', notes:[], journal:[], tags:[], price:'', createdAt:new Date(), userId:uid,
      ...(status==='ing'&&{startDate:new Date()}),
    });
    setSaving(false); onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <h2>새 {TYPES[type].name} 추가</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="search-row">
            <input type="text" placeholder="제목으로 검색" value={title}
              onChange={e=>setTitle(e.target.value)} onKeyPress={e=>e.key==='Enter'&&doSearch()}/>
            <button className="search-btn" onClick={doSearch} disabled={searching}>{searching?'…':'🔍'}</button>
          </div>
          {results.length>0&&(
            <div className="search-results">
              {results.map((r,i)=>(
                <div key={i} className={`search-result${saving?' disabled':''}`} onClick={()=>!saving&&selectResult(r)}>
                  {r.cover&&<img src={r.cover} alt=""/>}
                  <div>
                    <strong>{r.title}</strong>
                    {r.author&&<p>저자: {r.author}</p>}
                    {r.year&&<p>{r.year}</p>}
                  </div>
                  {saving&&<span className="saving-spin">저장중…</span>}
                </div>
              ))}
            </div>
          )}
          <div className="divider">또는 직접 입력</div>
          {preview&&<img src={preview} alt="" className="preview-img"/>}
          <input type="file" accept="image/*" onChange={handleFile} className="file-input"/>
          <select value={status} onChange={e=>setStatus(e.target.value)} className="status-select">
            {Object.entries(STATUS[type]).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="modal-footer">
          <div/>
          <div>
            <button onClick={onClose} className="btn-ghost">취소</button>
            <button onClick={submit} className="btn-primary" disabled={saving}>{saving?'저장중…':'추가'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailModal({ item, initialTab='info', onClose, allTags=[] }) {
  const [data, setData] = useState({...item});
  const [tab, setTab]   = useState(initialTab);
  const [noteSearch, setNoteSearch] = useState('');
  const [noteType, setNoteType]     = useState('text');
  const [noteText, setNoteText]     = useState('');
  const [noteSpeaker, setNoteSpkr]  = useState('');
  const [noteFile, setNoteFile]     = useState(null);
  const [notePreview, setNotePreview] = useState(null);
  const [editingNoteIdx, setEditingNoteIdx] = useState(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [newTag, setNewTag]         = useState('');
  const [tagSuggestions, setTagSuggestions] = useState([]);
  const [tagColorOpen, setTagColorOpen] = useState(null);
  const coverFileRef = useRef(null);
  const titleRef = useRef(null);
  const statusWrapRef = useRef(null);
  const tagsWrapRef = useRef(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const isTemporaryCover = url => typeof url === 'string' && url.startsWith('blob:');

  useEffect(()=>{
    if(titleRef.current){
      titleRef.current.style.height='auto';
      titleRef.current.style.height=titleRef.current.scrollHeight+'px';
    }
  }, [data.title]);

  useEffect(()=>{
    if (!statusOpen) return;
    const handler = e => {
      if (statusWrapRef.current && !statusWrapRef.current.contains(e.target)) setStatusOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, [statusOpen]);

  useEffect(()=>{
    if (!tagColorOpen) return;
    const handler = e => {
      if (tagsWrapRef.current && !tagsWrapRef.current.contains(e.target)) setTagColorOpen(null);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, [tagColorOpen]);

  const update = async () => {
    if (coverUploading) return alert('표지 업로드가 끝난 뒤 저장하세요');
    try {
      const { id, ...payload } = data;
      if (isTemporaryCover(payload.cover)) {
        payload.cover = item.cover && !isTemporaryCover(item.cover) ? item.cover : null;
      }
      await updateDoc(doc(db,'items',item.id), payload);
      onClose();
    } catch(e) { alert('저장 실패: ' + e.message); }
  };
  const remove = async () => {
    if (window.confirm('삭제?')) {
      try {
        await deleteDoc(doc(db,'items',item.id));
        onClose();
      } catch(e) { alert('삭제 실패: ' + e.message); }
    }
  };

  const handleCoverFile = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const prevCover = !isTemporaryCover(data.cover) ? (data.cover || null) : null;
    const localCover = URL.createObjectURL(f);
    setCoverUploading(true);
    setData(d => ({...d, cover: localCover}));
    try {
      const uploadFile = await compressCoverImage(f);
      const safeName = uploadFile.name.replace(/[^\w.-]+/g, '_') || 'cover.jpg';
      const sr = ref(storage, `covers/${Date.now()}_${safeName}`);
      await withTimeout(
        uploadBytes(sr, uploadFile, { contentType: uploadFile.type || f.type || 'image/jpeg' }),
        60000,
        '표지 업로드 시간이 너무 오래 걸립니다. 사진 용량이나 네트워크를 확인한 뒤 다시 시도해 주세요.'
      );
      const url = await withTimeout(
        getDownloadURL(sr),
        15000,
        '업로드된 표지 주소를 가져오지 못했습니다. 다시 시도해 주세요.'
      );
      setData(d => ({...d, cover: url}));
      await withTimeout(
        updateDoc(doc(db,'items',item.id), { cover:url }),
        15000,
        '표지 주소 저장이 지연되고 있습니다. 다시 시도해 주세요.'
      );
    } catch(err) {
      console.error(err);
      setData(d => ({...d, cover: prevCover}));
      alert('표지 변경 실패: ' + err.message);
    } finally {
      URL.revokeObjectURL(localCover);
      setCoverUploading(false);
      e.target.value='';
    }
  };

  const changeStatus=s=>{
    const up={status:s};
    if(s==='ing' && !data.startDate) up.startDate=new Date();
    if(s==='done' && !data.endDate)  up.endDate=new Date();
    setData({...data,...up});
  };

  const STATUS_KO = { want:'wish', ing:'ing', yet:'yet', done:'done' };

  const tagStyle = color => {
    if (!color) return {};
    const r=parseInt(color.slice(1,3),16), g=parseInt(color.slice(3,5),16), b=parseInt(color.slice(5,7),16);
    return { background:`rgba(${r},${g},${b},.13)`, color };
  };

  const setTagColor = (t, color) => {
    setData(d => ({...d, tagColors:{...(d.tagColors||{}), [t]:color}}));
    setTagColorOpen(null);
  };

  const addTag = (tagName) => {
    const t = (tagName || newTag).trim();
    if (!t) return;
    const tags = data.tags || [];
    if (!tags.includes(t)) setData(d => ({...d, tags:[...tags, t]}));
    setNewTag(''); setTagSuggestions([]);
  };

  const removeTag = t => setData(d => ({...d, tags:(d.tags||[]).filter(x=>x!==t)}));

  const handleTagInput = val => {
    setNewTag(val);
    if (val.trim()) {
      const s = allTags.filter(t => t.toLowerCase().includes(val.toLowerCase()) && !(data.tags||[]).includes(t));
      setTagSuggestions(s.slice(0,6));
    } else { setTagSuggestions([]); }
  };

  const handleNoteFile=e=>{
    const f=e.target.files[0]; if(!f)return;
    setNoteFile(f);
    const r=new FileReader(); r.onloadend=()=>setNotePreview(r.result); r.readAsDataURL(f);
  };

  const resetNoteForm = () => {
    setNoteText('');
    setNoteSpkr('');
    setNoteFile(null);
    setNotePreview(null);
    setEditingNoteIdx(null);
  };

  const saveNote=async()=>{
    let note = null;
    const prevNote = editingNoteIdx !== null ? (data.notes||[])[editingNoteIdx] : null;
    if(noteType==='text'){
      if(!noteText.trim())return;
      note={type:'text', text:noteText, date:prevNote?.date||new Date()};
    } else if(noteType==='quote'){
      if(!noteText.trim())return;
      note={type:'quote', text:noteText, speaker:noteSpeaker, date:prevNote?.date||new Date()};
    } else if(noteType==='photo'){
      if(!noteFile && !prevNote?.imageUrl)return;
      let imageUrl=prevNote?.imageUrl||notePreview;
      if(noteFile){
        try {
          const sr=ref(storage,`notes/${Date.now()}`);
          await uploadBytes(sr,noteFile);
          imageUrl=await getDownloadURL(sr);
        } catch(e){ console.error(e); }
      }
      note={type:'photo', imageUrl, caption:noteText, date:prevNote?.date||new Date()};
    }
    const notes = [...(data.notes||[])];
    if(editingNoteIdx !== null) notes[editingNoteIdx] = note;
    else notes.push(note);
    setData({...data, notes});
    resetNoteForm();
  };

  const removeNote=idx=>setData({...data, notes:(data.notes||[]).filter((_,i)=>i!==idx)});
  const editNote=(idx)=>{
    const n=(data.notes||[])[idx];
    if(!n)return;
    setEditingNoteIdx(idx);
    setNoteType(n.type||'text');
    setNoteText(n.type==='photo' ? (n.caption||'') : (n.text||''));
    setNoteSpkr(n.speaker||'');
    setNoteFile(null);
    setNotePreview(n.imageUrl||null);
  };

  const filteredNotesWithIndex=(data.notes||[])
    .map((note,idx)=>({note,idx}))
    .filter(({note:n})=>{
      if(!noteSearch) return true;
      const q=noteSearch.toLowerCase();
      return (n.text||'').toLowerCase().includes(q)||(n.speaker||'').toLowerCase().includes(q)||(n.caption||'').toLowerCase().includes(q);
    })
    .sort((a,b)=>(toMs(b.note.date)||b.idx)-(toMs(a.note.date)||a.idx));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box detail" onClick={e=>e.stopPropagation()}>

        {/* Top bar */}
        <div className="dm-topbar">
          <div className="dm-badges">
            <span className="dm-type-badge">{TYPES[data.type]?.name}</span>
            <span className={`dm-status-badge dm-status-${data.status||'want'}`}>
              {STATUS[data.type]?.[data.status]||data.status}
            </span>
          </div>
          <div className="dm-topbar-actions">
            <button className="dm-cover-btn" onClick={()=>coverFileRef.current?.click()} disabled={coverUploading}>
              {coverUploading ? '…' : '📷'}
            </button>
            <input ref={coverFileRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleCoverFile}/>
            <button className="dm-close" onClick={onClose}>×</button>
          </div>
        </div>

        {/* Tabs: 정보, 메모 */}
        <div className="dm-tabs">
          {['info','notes'].map((t,i)=>(
            <button key={t} className={`dm-tab${tab===t?' active':''}`} onClick={()=>setTab(t)}>
              {['정보','메모'][i]}
            </button>
          ))}
        </div>

        <div className="modal-body">

          {tab==='info'&&(
            <div className="notion-props">
              <textarea ref={titleRef} className="notion-title-input"
                value={data.title||''} onChange={e=>setData({...data,title:e.target.value})}
                placeholder="제목" rows={1}/>

              {(data.type==='book'||data.type==='novel'||data.type==='comic') && (
                <div className="nprop-row">
                  <span className="nprop-icon"><PenLine size={14} strokeWidth={1.8}/></span>
                  <span className="nprop-key nprop-key-sm">작가</span>
                  <input type="text" className="nprop-input" value={data.author||''} onChange={e=>setData({...data,author:e.target.value})}/>
                </div>
              )}
              {data.type==='video' && (
                <div className="nprop-row">
                  <span className="nprop-icon"><Film size={14} strokeWidth={1.8}/></span>
                  <span className="nprop-key nprop-key-sm">감독</span>
                  <input type="text" className="nprop-input" value={data.director||''} onChange={e=>setData({...data,director:e.target.value})}/>
                </div>
              )}

              <div className="nprop-row nprop-star-row">
                <span className="nprop-icon"><Star size={14} strokeWidth={1.8}/></span>
                <span className="nprop-key">별점</span>
                <StarInput value={data.rating||0} onChange={v=>setData({...data,rating:v})}/>
              </div>

              <div className="nprop-row nprop-row-lg">
                <span className="nprop-icon"><Circle size={14} strokeWidth={1.8}/></span>
                <span className="nprop-key">상태</span>
                <div className="status-pill-wrap" ref={statusWrapRef}>
                  <button className={`status-pill ${data.status||'want'} active`} onClick={()=>setStatusOpen(o=>!o)}>
                    {STATUS_KO[data.status||'want']}
                  </button>
                  {statusOpen && (
                    <div className="status-pill-popup">
                      {Object.entries(STATUS[data.type]||{}).map(([k])=>(
                        <button key={k} className={`status-pill ${k}${(data.status||'want')===k?' active':''}`}
                          onClick={()=>{changeStatus(k);setStatusOpen(false);}}>
                          {STATUS_KO[k]||k}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="nprop-row nprop-tags-row">
                <span className="nprop-icon"><Tag size={14} strokeWidth={1.8}/></span>
                <span className="nprop-key">태그</span>
                <div className="nprop-tags-outer" ref={tagsWrapRef}>
                  {/* 가로 스크롤 영역: 태그 + 입력창 */}
                  <div className="nprop-tags-inline">
                    {(data.tags||[]).map(t=>{
                      const color=(data.tagColors||{})[t];
                      return (
                        <span key={t} className={`tag tag-clickable${tagColorOpen===t?' tag-active':''}`}
                          style={tagStyle(color)}
                          onClick={()=>setTagColorOpen(tagColorOpen===t?null:t)}>
                          #{t}
                          <button className="tag-x" onClick={e=>{e.stopPropagation();removeTag(t);}}>×</button>
                        </span>
                      );
                    })}
                    <input type="text" className="nprop-tag-input"
                      placeholder={!(data.tags||[]).length?'태그 추가':''}
                      value={newTag}
                      onChange={e=>handleTagInput(e.target.value)}
                      onFocus={()=>{
                        if(!newTag.trim()){
                          const s=allTags.filter(t=>!(data.tags||[]).includes(t));
                          setTagSuggestions(s.slice(0,6));
                        }
                      }}
                      onKeyDown={e=>{
                        if(e.key==='Enter'){e.preventDefault();addTag();}
                        if(e.key==='Backspace'&&!newTag&&(data.tags||[]).length) removeTag((data.tags||[]).at(-1));
                      }}
                      onBlur={()=>setTimeout(()=>setTagSuggestions([]),150)}
                    />
                  </div>
                  {/* 오버레이들: scroll 컨테이너 밖, outer 안 */}
                  {tagColorOpen&&(
                    <div className="tag-color-picker">
                      {TAG_COLORS.map(c=>{
                        const cur=(data.tagColors||{})[tagColorOpen];
                        return (
                          <button key={c} className={`tag-color-opt${cur===c?' sel':''}`}
                            style={{background:c}} onMouseDown={()=>setTagColor(tagColorOpen,c)}/>
                        );
                      })}
                    </div>
                  )}
                  {tagSuggestions.length>0&&(
                    <div className="tag-suggestions">
                      {tagSuggestions.map(s=>(
                        <button key={s} className="tag-suggestion-item" onMouseDown={()=>addTag(s)}>#{s}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="nprop-row">
                <span className="nprop-icon"><MessageSquare size={14} strokeWidth={1.8}/></span>
                <span className="nprop-key nprop-key-sm">한줄평</span>
                <input type="text" className="nprop-input" value={data.oneliner||''} onChange={e=>setData({...data,oneliner:e.target.value})} placeholder="한 줄로 남겨요"/>
              </div>

              <div className="nprop-row nprop-row-date">
                <span className="nprop-icon"><Calendar size={14} strokeWidth={1.8}/></span>
                <span className="nprop-key">날짜</span>
                <div className="nprop-dates">
                  <input type="date" className="nprop-date-input"
                    value={toDateStr(data.startDate)}
                    onChange={e=>setData({...data,startDate:e.target.value?new Date(e.target.value):null})}/>
                  <span className="nprop-date-sep">→</span>
                  <input type="date" className="nprop-date-input"
                    value={toDateStr(data.endDate||data.viewDate)}
                    onChange={e=>setData({...data,endDate:e.target.value?new Date(e.target.value):null,viewDate:e.target.value?new Date(e.target.value):null})}/>
                </div>
              </div>

              <div className="nprop-row nprop-row-lg-b">
                <span className="nprop-icon"><Repeat2 size={14} strokeWidth={1.8}/></span>
                <span className="nprop-key nprop-key-replay">{REPLAY_LABEL[data.type]||'반복'}</span>
                <div className="replay-row">
                  <button className="replay-btn" onClick={()=>setData({...data,replayCount:Math.max(0,(data.replayCount||0)-1)})}>−</button>
                  <span className="replay-count">{data.replayCount||0}</span>
                  <button className="replay-btn" onClick={()=>setData({...data,replayCount:(data.replayCount||0)+1})}>+</button>
                  <span className="replay-unit">회</span>
                </div>
              </div>

              {data.cover && (!isTemporaryCover(data.cover) || coverUploading) && (
                <button type="button" className="detail-cover-bottom" onClick={()=>coverFileRef.current?.click()} disabled={coverUploading} title="표지 변경">
                  <img src={data.cover} alt="cover" className="detail-cover-img"/>
                </button>
              )}

              <div className="detail-review-section">
                <textarea className="detail-inline-review"
                  placeholder="리뷰를 남겨보세요..."
                  value={data.review||''}
                  onChange={e=>setData({...data,review:e.target.value})}/>
              </div>
            </div>
          )}

          {tab==='notes'&&(
            <>
              <div className="note-search-wrap">
                <span>🔍</span>
                <input type="text" placeholder="메모 검색" value={noteSearch} onChange={e=>setNoteSearch(e.target.value)} className="note-search"/>
              </div>
              <div className="note-type-sel">
                {[['text','📝 텍스트'],['quote','💬 대사'],['photo','📷 사진']].map(([v,l])=>(
                  <button key={v} className={`ntype-btn${noteType===v?' active':''}`} onClick={()=>setNoteType(v)}>{l}</button>
                ))}
              </div>
              <div className="add-note">
                {noteType==='photo'&&(
                  <>
                    <input type="file" accept="image/*" onChange={handleNoteFile} className="file-input"/>
                    {notePreview&&<img src={notePreview} alt="" className="note-photo-preview"/>}
                    <input type="text" placeholder="캡션 (선택)" value={noteText} onChange={e=>setNoteText(e.target.value)}/>
                  </>
                )}
                {noteType==='quote'&&(
                  <>
                    <textarea placeholder="대사 또는 인용구" value={noteText} onChange={e=>setNoteText(e.target.value)} rows="3"/>
                    <input type="text" placeholder="화자 (선택)" value={noteSpeaker} onChange={e=>setNoteSpkr(e.target.value)} style={{marginTop:6}}/>
                  </>
                )}
                {noteType==='text'&&(
                  <textarea placeholder="메모 추가" value={noteText} onChange={e=>setNoteText(e.target.value)} rows="3"/>
                )}
                <div className="note-form-actions">
                  {editingNoteIdx !== null && (
                    <button className="btn-ghost note-cancel-edit" onClick={resetNoteForm}>취소</button>
                  )}
                  <button className="btn-primary" onClick={saveNote}>
                    {editingNoteIdx !== null ? '수정 완료' : '추가'}
                  </button>
                </div>
              </div>
              <div className="notes-list">
                {filteredNotesWithIndex.map(({note:n,idx})=>(
                  <div key={idx} className={`note-item note-${n.type||'text'}`}>
                    {n.type==='photo'&&n.imageUrl&&<img src={n.imageUrl} alt={n.caption} className="note-photo"/>}
                    {n.type==='quote'&&<span className="quote-mark">"</span>}
                    <p>{n.type==='photo'?n.caption:n.text}</p>
                    {n.type==='quote'&&n.speaker&&<p className="speaker">— {n.speaker}</p>}
                    <div className="note-foot">
                      <small>{new Date(toMs(n.date)||0).toLocaleDateString()}</small>
                      <div className="note-actions">
                        <button className="note-action note-edit" title="수정" onClick={()=>editNote(idx)}>
                          <PenLine size={14} strokeWidth={1.8}/>
                        </button>
                        <button className="note-action note-del" title="삭제" onClick={()=>removeNote(idx)}>×</button>
                      </div>
                    </div>
                  </div>
                ))}
                {filteredNotesWithIndex.length===0&&<p className="empty-note">메모 없음</p>}
              </div>
            </>
          )}

        </div>

        {/* Floating save/delete */}
        <div className="detail-float-actions">
          <button onClick={remove} className="detail-float-danger">삭제</button>
          <button onClick={update} className="detail-float-primary" disabled={coverUploading}>
            {coverUploading ? '업로드 중…' : '저장'}
          </button>
        </div>

      </div>
    </div>
  );
}
