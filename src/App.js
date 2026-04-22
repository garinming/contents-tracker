import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { CUSTOM_FONTS } from './customFonts';
import { db, storage } from './firebase';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import './App.css';

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
const STATUS_COLORS = {
  want: { bg: '#FFE8F0', dot: '#FF6B9D' },
  ing:  { bg: '#FFF4E6', dot: '#FF9F43' },
  yet:  { bg: '#F4F4F8', dot: '#AEAEB2' },
  done: { bg: '#E8F8F0', dot: '#2ECC71' },
};
const ACCENT_COLORS = [
  '#FF6B9D','#4A90E2','#9B59B6','#27AE60','#F5A623','#FF6B6B'
];
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
function starStr(rating, max=5) {
  if (!rating || rating<=0) return '—';
  let s='';
  for(let i=1;i<=max;i++){
    if(rating>=i) s+='★';
    else if(rating>=i-0.5) s+='½';
    else s+='☆';
  }
  return s;
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
      const url = `https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?ttbkey=${API_KEYS.aladin}&Query=${encodeURIComponent(query)}&QueryType=Title&MaxResults=5&start=1&SearchTarget=Book&output=js&Version=20131101`;
      const res  = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
      const data = await res.json();
      return (data.item||[]).map(i=>({
        title:  i.title.replace(/ *\([^)]*\) */g,''),
        cover:  i.cover,
        author: i.author,
        year:   i.pubDate?.substring(0,4),
        genre:  i.categoryName?.split('>')[1]?.trim()
      }));
    }
    return [];
  } catch(e){ console.error(e); return []; }
}

export default function App() {
  const [view, setView]         = useState('home');
  const [type, setType]         = useState(null);
  const [gameTab, setGameTab]   = useState('main');
  const [items, setItems]       = useState([]);
  const [gameEvents, setGameEvents] = useState([]);
  const [todos, setTodos]       = useState([]);
  const [mode, setMode]         = useState('album');
  const [search, setSearch]     = useState('');
  const [selected, setSelected] = useState(null);
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
    // Safari fix: inject <style> with !important for font-family
    let styleEl = document.getElementById('font-override');
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id='font-override'; document.head.appendChild(styleEl); }
    styleEl.textContent = `html,body,body *,input,button,select,textarea,h1,h2,h3,h4,h5,h6,p,span,div{font-family:${f.family}!important;-webkit-font-smoothing:antialiased;}.home-card-icon span,.home-topbar-icon{font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif!important;}.fab{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif!important;line-height:1;}`;
    localStorage.setItem('accentColor', accentColor);
    localStorage.setItem('font', font);
  },[accentColor,font]);

  useEffect(()=>{
    window.scrollTo(0, 0);
  },[view, type]);

  useEffect(()=>{ localStorage.setItem('calPicks', JSON.stringify(calPicks)); },[calPicks]);
  useEffect(()=>{ localStorage.setItem('goals', JSON.stringify(goals)); },[goals]);
  useEffect(()=>{ localStorage.setItem('savedFilters', JSON.stringify(savedFilters)); },[savedFilters]);

  useEffect(()=>{
    const u1 = onSnapshot(collection(db,'items'), snap=>{
      const d=[]; snap.forEach(x=>d.push({id:x.id,...x.data()})); setItems(d);
    });
    const u2 = onSnapshot(collection(db,'gameEvents'), snap=>{
      const d=[]; snap.forEach(x=>d.push({id:x.id,...x.data()})); setGameEvents(d);
    });
    const u3 = onSnapshot(collection(db,'todos'), snap=>{
      const d=[]; snap.forEach(x=>d.push({id:x.id,...x.data()}));
      setTodos(d.sort((a,b)=>{
        const ad=toMs(a.dueDate), bd=toMs(b.dueDate);
        if(ad&&bd) return ad-bd;
        if(ad) return -1; if(bd) return 1;
        return (toMs(a.createdAt)||0)-(toMs(b.createdAt)||0);
      }));
    });
    return ()=>{ u1(); u2(); u3(); };
  },[]);

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

  return (
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
        <button className="fab" onClick={()=>setShowAdd(true)}>+</button>
      )}

      <nav className="tabs">
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
      {selected && <DetailModal item={selected} onClose={()=>setSelected(null)} />}
      {dayPicker && (
        <DayPickSheet
          items={dayPicker.items} dateStr={dayPicker.dateStr}
          currentPick={calPicks[dayPicker.dateStr]}
          onPick={(itemId)=>{ setCalPicks(p=>({...p,[dayPicker.dateStr]:itemId})); setDayPicker(null); }}
          onClose={()=>setDayPicker(null)}
        />
      )}
    </div>
  );
}

/* ── HOME ── */
function Home({ items, username, goals, onSelect }) {
  const ingCount = items.filter(i=>i.status==='ing').length;
  const ingByType  = items.reduce((a,i)=>{ if(i.status==='ing')  a[i.type]=(a[i.type]||0)+1; return a; },{});
  const doneByType = items.reduce((a,i)=>{ if(i.status==='done') a[i.type]=(a[i.type]||0)+1; return a; },{});

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
                {goal>0 && (
                  <div className="home-card-goal-badge">
                    <span className="hg-num">{done}</span>
                    <span className="hg-sep">/</span>
                    <span className="hg-total">{goal}</span>
                  </div>
                )}
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
    else await addDoc(collection(db,'gameEvents'), {...payload, createdAt:new Date()});
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
        dueDate: (!skip && dueDate) ? new Date(dueDate) : null
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

/* ── LIBRARY GROUPS ── */
function LibraryGroups({ groups, statuses, mode, onSelect }) {
  const [statusView, setStatusView] = useState(null);

  // table mode: grouped list
  if (mode === 'table') {
    return (
      <div className="groups">
        {STATUS_ORDER.map(sk=>{
          const its=groups[sk]||[]; if(!its.length) return null;
          const col=STATUS_COLORS[sk];
          return (
            <div key={sk} className="group">
              <div className="group-hd" style={{background:col.bg}}>
                <span className="group-dot" style={{background:col.dot}}/>
                <span className="group-lbl">{statuses[sk]}</span>
                <span className="group-cnt">{its.length}</span>
              </div>
              <div className="tlist">{its.map(i=>(
                <div key={i.id} className="trow" onClick={()=>onSelect(i)}>
                  <span className="trow-title">{i.title}</span>
                  <span>{i.rating>0?'⭐'.repeat(i.rating):''}</span>
                  <span className="trow-sub">{i.genre||'-'}</span>
                  <span className="trow-sub">{i.price?`${parseFloat(i.price).toLocaleString()}원`:'-'}</span>
                </div>
              ))}</div>
            </div>
          );
        })}
      </div>
    );
  }

  // album mode – status items detail
  if (statusView) {
    const its=groups[statusView]||[];
    const col=STATUS_COLORS[statusView];
    return (
      <div className="sov-items-page">
        <div className="sov-items-hd">
          <button className="sov-back" onClick={()=>setStatusView(null)}>‹ 뒤로</button>
          <span className="sov-items-title" style={{color:col.dot}}>{statuses[statusView]}</span>
          <span className="sov-items-cnt">{its.length}</span>
        </div>
        <div className="status-grid">
          {its.map(i=><StatusCard key={i.id} item={i} onClick={()=>onSelect(i)}/>)}
        </div>
      </div>
    );
  }

  // album mode – overview
  return (
    <div className="sov-wrap">
      {STATUS_ORDER.map(sk=>{
        const its=groups[sk]||[]; if(!its.length) return null;
        const col=STATUS_COLORS[sk];
        return (
          <div key={sk} className="sov-card" style={{background:col.bg}} onClick={()=>setStatusView(sk)}>
            <div className="sov-card-hd">
              <span className="sov-dot" style={{background:col.dot}}/>
              <span className="sov-label">{statuses[sk]}</span>
              <span className="sov-cnt">{its.length}</span>
            </div>
            <div className="sov-thumbs">
              {its.slice(0,3).map(item=>(
                item.cover
                  ? <img key={item.id} src={item.cover} alt="" className="sov-thumb"/>
                  : <div key={item.id} className="sov-thumb sov-ph">{TYPES[item.type]?.emoji||'📦'}</div>
              ))}
            </div>
          </div>
        );
      })}
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
function CalendarView({ items, calPicks, onPickSet, onDayPick, onSelect }) {
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
    .filter(i=>i.review?.trim())
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
                <div key={item.id} className="review-card" onClick={()=>onSelect&&onSelect(item)} style={{cursor:'pointer'}}>
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
  const fileRef = useRef();
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
            cover:null, notes:[], journal:[], createdAt:new Date(),
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
    </div>
  );
}

/* ── ADD MODAL ── */
function AddModal({ type, onClose }) {
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
      review:'', notes:[], journal:[], tags:[], price:'', createdAt:new Date(),
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
      genre:'', author:'', director:'', review:'', notes:[], journal:[], tags:[], price:'', createdAt:new Date(),
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

/* ── DETAIL MODAL ── */
const PROGRESS_UNIT = { game:'시간', video:'화', book:'페이지', novel:'페이지', comic:'화' };

function DetailModal({ item, onClose }) {
  const [data, setData] = useState({...item});
  const [tab, setTab]   = useState('info');
  const [noteSearch, setNoteSearch] = useState('');
  const [noteType, setNoteType]     = useState('text');
  const [noteText, setNoteText]     = useState('');
  const [noteSpeaker, setNoteSpkr]  = useState('');
  const [noteFile, setNoteFile]     = useState(null);
  const [notePreview, setNotePreview] = useState(null);
  const [newTag, setNewTag]         = useState('');
  const coverFileRef = useRef(null);

  const update=async()=>{ onClose(); updateDoc(doc(db,'items',item.id),data); };
  const remove=async()=>{ if(window.confirm('삭제?')){ onClose(); deleteDoc(doc(db,'items',item.id)); } };

  const handleCoverFile = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const sr = ref(storage, `covers/${Date.now()}_${f.name}`);
      await uploadBytes(sr, f);
      const url = await getDownloadURL(sr);
      setData(d => ({...d, cover: url}));
    } catch(err) { console.error(err); }
  };

  const changeStatus=s=>{
    const up={status:s};
    if(s==='ing' && !data.startDate) up.startDate=new Date();
    if(s==='done' && !data.endDate)  up.endDate=new Date();
    setData({...data,...up});
  };

  const addTag=()=>{
    if(!newTag.trim())return;
    const tags=data.tags||[];
    if(!tags.includes(newTag)) setData({...data,tags:[...tags,newTag]});
    setNewTag('');
  };

  const handleNoteFile=e=>{
    const f=e.target.files[0]; if(!f)return;
    setNoteFile(f);
    const r=new FileReader(); r.onloadend=()=>setNotePreview(r.result); r.readAsDataURL(f);
  };

  const addNote=async()=>{
    let note = null;
    if(noteType==='text'){
      if(!noteText.trim())return;
      note={type:'text', text:noteText, date:new Date()};
    } else if(noteType==='quote'){
      if(!noteText.trim())return;
      note={type:'quote', text:noteText, speaker:noteSpeaker, date:new Date()};
    } else if(noteType==='photo'){
      if(!noteFile)return;
      let imageUrl=notePreview;
      try {
        const sr=ref(storage,`notes/${Date.now()}`);
        await uploadBytes(sr,noteFile);
        imageUrl=await getDownloadURL(sr);
      } catch(e){ console.error(e); }
      note={type:'photo', imageUrl, caption:noteText, date:new Date()};
    }
    setData({...data, notes:[...(data.notes||[]),note]});
    setNoteText(''); setNoteSpkr(''); setNoteFile(null); setNotePreview(null);
  };

  const removeNote=idx=>setData({...data, notes:(data.notes||[]).filter((_,i)=>i!==idx)});

  const filteredNotes=(data.notes||[]).filter(n=>{
    if(!noteSearch) return true;
    const q=noteSearch.toLowerCase();
    return (n.text||'').toLowerCase().includes(q)||(n.speaker||'').toLowerCase().includes(q)||(n.caption||'').toLowerCase().includes(q);
  });

  const pct = data.progressTotal>0 && data.progressCurrent>0
    ? Math.min(100, Math.round(data.progressCurrent/data.progressTotal*100)) : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box detail" onClick={e=>e.stopPropagation()}>

        {/* Hero cover */}
        <div className="dm-hero">
          {data.cover
            ? <img src={data.cover} alt="" className="dm-hero-img"/>
            : <div className="dm-hero-ph">{TYPES[data.type]?.emoji||'📦'}</div>
          }
          <button className="dm-close" onClick={onClose}>×</button>
          <button className="dm-cover-edit" onClick={()=>coverFileRef.current?.click()}>📷</button>
          <input ref={coverFileRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleCoverFile}/>
          <div className="dm-hero-foot">
            <span className="dm-type-badge">{TYPES[data.type]?.name}</span>
            <span className={`dm-status-badge dm-status-${data.status||'want'}`}>
              {STATUS[data.type]?.[data.status]||data.status}
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="dm-tabs">
          {['info','notes','review'].map((t,i)=>(
            <button key={t} className={`dm-tab${tab===t?' active':''}`} onClick={()=>setTab(t)}>
              {['정보','메모','리뷰'][i]}
            </button>
          ))}
        </div>

        <div className="modal-body">

          {tab==='info'&&(
            <div className="notion-props">
              <input type="text" className="notion-title-input"
                value={data.title||''} onChange={e=>setData({...data,title:e.target.value})}
                placeholder="제목"/>

              <div className="nprop-row">
                <span className="nprop-key">상태</span>
                <select className="nprop-select" value={data.status||'want'} onChange={e=>changeStatus(e.target.value)}>
                  {Object.entries(STATUS[data.type]||{}).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                </select>
              </div>

              <div className="nprop-row nprop-tags-row">
                <span className="nprop-key">태그</span>
                <div className="nprop-tags-val">
                  {(data.tags||[]).map(t=>(
                    <span key={t} className="tag">#{t}
                      <button onClick={()=>setData({...data,tags:(data.tags||[]).filter(x=>x!==t)})}>×</button>
                    </span>
                  ))}
                  <input type="text" className="nprop-tag-input" placeholder="+" value={newTag}
                    onChange={e=>setNewTag(e.target.value)}
                    onKeyPress={e=>e.key==='Enter'&&addTag()}/>
                </div>
              </div>

              <div className="nprop-row nprop-star-row">
                <span className="nprop-key">별점</span>
                <StarInput value={data.rating||0} onChange={v=>setData({...data,rating:v})}/>
              </div>

              <div className="nprop-row">
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

              <div className="nprop-row nprop-progress-row">
                <span className="nprop-key">진행률</span>
                <div className="nprop-progress-val">
                  <div className="progress-input-row">
                    <input type="number" min="0" placeholder="현재"
                      value={data.progressCurrent||''}
                      onChange={e=>setData({...data,progressCurrent:e.target.value})}
                      className="progress-num-input"/>
                    <span className="progress-slash">/</span>
                    <input type="number" min="0" placeholder="총"
                      value={data.progressTotal||''}
                      onChange={e=>setData({...data,progressTotal:e.target.value})}
                      className="progress-num-input"/>
                    <span className="progress-unit">{PROGRESS_UNIT[data.type]||''}</span>
                  </div>
                  {pct!==null && (
                    <div className="progress-bar-wrap" style={{marginTop:6}}>
                      <div className="progress-bar-fill" style={{width:`${pct}%`}}/>
                      <span className="progress-pct">{pct}%</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="nprop-row">
                <span className="nprop-key">{REPLAY_LABEL[data.type]||'반복'}</span>
                <div className="replay-row">
                  <button className="replay-btn" onClick={()=>setData({...data,replayCount:Math.max(0,(data.replayCount||0)-1)})}>−</button>
                  <span className="replay-count">{data.replayCount||0}</span>
                  <button className="replay-btn" onClick={()=>setData({...data,replayCount:(data.replayCount||0)+1})}>+</button>
                  <span className="replay-unit">회</span>
                </div>
              </div>

              {data.type==='video' && (
                <div className="nprop-row">
                  <span className="nprop-key">감독</span>
                  <input type="text" className="nprop-input" value={data.director||''} onChange={e=>setData({...data,director:e.target.value})}/>
                </div>
              )}
              {(data.type==='book'||data.type==='novel'||data.type==='comic') && (
                <div className="nprop-row">
                  <span className="nprop-key">작가</span>
                  <input type="text" className="nprop-input" value={data.author||''} onChange={e=>setData({...data,author:e.target.value})}/>
                </div>
              )}
              <div className="nprop-row">
                <span className="nprop-key">장르</span>
                <input type="text" className="nprop-input" value={data.genre||''} onChange={e=>setData({...data,genre:e.target.value})}/>
              </div>
              <div className="nprop-row">
                <span className="nprop-key">가격</span>
                <input type="number" className="nprop-input" value={data.price||''} onChange={e=>setData({...data,price:e.target.value})} placeholder="원"/>
              </div>
              <div className="nprop-row">
                <span className="nprop-key">한줄평</span>
                <input type="text" className="nprop-input" value={data.oneliner||''} onChange={e=>setData({...data,oneliner:e.target.value})} placeholder="한 줄로 남겨요"/>
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
                <button className="btn-primary" style={{marginTop:8,width:'100%'}} onClick={addNote}>추가</button>
              </div>
              <div className="notes-list">
                {filteredNotes.map((n,i)=>(
                  <div key={i} className={`note-item note-${n.type||'text'}`}>
                    {n.type==='photo'&&n.imageUrl&&<img src={n.imageUrl} alt={n.caption} className="note-photo"/>}
                    {n.type==='quote'&&<span className="quote-mark">"</span>}
                    <p>{n.type==='photo'?n.caption:n.text}</p>
                    {n.type==='quote'&&n.speaker&&<p className="speaker">— {n.speaker}</p>}
                    <div className="note-foot">
                      <small>{new Date(toMs(n.date)||0).toLocaleDateString()}</small>
                      <button className="note-del" onClick={()=>removeNote(i)}>×</button>
                    </div>
                  </div>
                ))}
                {filteredNotes.length===0&&<p className="empty-note">메모 없음</p>}
              </div>
            </>
          )}

          {tab==='review'&&(
            <div className="review-tab-content">
              <textarea className="review-textarea"
                placeholder="리뷰를 남겨보세요..."
                value={data.review||''}
                onChange={e=>setData({...data,review:e.target.value})}
                rows="10"/>
              <p className="review-hint">저장 후 Activity 탭 리뷰에서 확인됩니다</p>
            </div>
          )}

        </div>
        <div className="modal-footer">
          <button onClick={remove} className="btn-danger">삭제</button>
          <div>
            <button onClick={onClose} className="btn-ghost">취소</button>
            <button onClick={update} className="btn-primary">저장</button>
          </div>
        </div>
      </div>
    </div>
  );
}
