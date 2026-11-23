import React, { useState, useEffect, useRef } from 'react';
import { db } from './firebase';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, where } from 'firebase/firestore';

/*
 * 게임 일기: 사진 + 짧은 글을 날짜순으로 이어 붙이는 피드.
 * 사진은 압축한 data URL로 Firestore 문서에 함께 저장한다
 * (Storage CORS 없이도 이미지 내보내기가 되도록).
 */

const COL = 'gameDiary';
const MAX_PHOTOS = 4;
const MAX_DOC_CHARS = 900000; // Firestore 문서 1MB 제한 여유분
const COMPRESS_LEVELS = [[1440, 0.82], [1280, 0.78], [1080, 0.72], [900, 0.66], [720, 0.6], [560, 0.55]];

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  const wd = '일월화수목금토'[new Date(y, m - 1, d).getDay()];
  return `${y}.${m}.${d} (${wd})`;
}
function fmtMonth(s) {
  const [y, m] = s.split('-').map(Number);
  return `${y}년 ${m}월`;
}
function createdMs(e) {
  const v = e.createdAt;
  if (!v) return 0;
  if (v.seconds) return v.seconds * 1000;
  if (v instanceof Date) return v.getTime();
  return new Date(v).getTime() || 0;
}
function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('이미지를 불러오지 못했어요'));
    img.src = src;
  });
}
async function compressFile(file, budget) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    let out = null;
    for (const [side, q] of COMPRESS_LEVELS) {
      const s = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * s));
      c.height = Math.max(1, Math.round(img.naturalHeight * s));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      out = c.toDataURL('image/jpeg', q);
      if (out.length <= budget) break;
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function compressAll(files, textLen) {
  if (!files.length) return [];
  const budget = Math.floor((MAX_DOC_CHARS - textLen * 3) / files.length);
  const out = [];
  for (const f of files) out.push(await compressFile(f, budget));
  return out;
}
function groupByDate(list) {
  const groups = [];
  list.forEach(e => {
    const last = groups[groups.length - 1];
    if (last && last.date === e.date) last.items.push(e);
    else groups.push({ date: e.date, items: [e] });
  });
  return groups;
}

/* ── 이미지 내보내기 (canvas 직접 그리기) ── */
const EX_W = 1080;
const EX_PAD = 72;
const EX_PAGE_MAX = 12000; // iOS 캔버스 면적 제한(약 16.7M px) 안쪽
const EX_IMG_MAX_H = 1500;

function wrapLines(ctx, text, maxW) {
  const lines = [];
  String(text).split('\n').forEach(para => {
    if (!para) { lines.push(''); return; }
    let line = '';
    let lastSpace = -1;
    for (const ch of para) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxW && line) {
        if (ch !== ' ' && lastSpace > 0) {
          lines.push(line.slice(0, lastSpace));
          line = line.slice(lastSpace + 1) + ch;
        } else {
          lines.push(line);
          line = ch === ' ' ? '' : ch;
        }
        lastSpace = -1;
      } else {
        line = test;
      }
      if (ch === ' ') lastSpace = line.length - 1;
    }
    lines.push(line);
  });
  return lines;
}
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function renderDiaryImages(groups, rangeLabel) {
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#FF6B9D';
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const F = {
    label: `700 26px ${family}`,
    title: `800 56px ${family}`,
    range: `500 28px ${family}`,
    date:  `700 26px ${family}`,
    body:  `400 36px ${family}`,
    foot:  `500 24px ${family}`,
  };
  const BODY_LH = 58;
  const innerW = EX_W - EX_PAD * 2;

  const measure = document.createElement('canvas').getContext('2d');
  measure.font = F.body;

  // 사진 미리 로드
  const imgCache = new Map();
  for (const g of groups) for (const e of g.items) for (const p of (e.photos || [])) {
    if (!imgCache.has(p)) {
      try { imgCache.set(p, await loadImage(p)); } catch { imgCache.set(p, null); }
    }
  }

  // 단위(unit) = 하나의 엔트리 (그날 첫 엔트리는 날짜 라벨 포함). 페이지는 unit 경계에서만 나눈다.
  const units = [];
  groups.forEach((g, gi) => {
    g.items.forEach((e, ei) => {
      const ops = [];
      let h = 0;
      if (ei === 0) {
        if (gi > 0) h += 40;
        ops.push({ k: 'date', y: h, text: fmtDate(g.date) });
        h += 52;
      } else {
        h += 44;
      }
      (e.photos || []).forEach((p, pi) => {
        const img = imgCache.get(p);
        if (!img) return;
        if (pi > 0) h += 16;
        let w = innerW;
        let ih = Math.round(img.naturalHeight * (innerW / img.naturalWidth));
        if (ih > EX_IMG_MAX_H) { w = Math.round(innerW * EX_IMG_MAX_H / ih); ih = EX_IMG_MAX_H; }
        ops.push({ k: 'img', y: h, img, w, h: ih });
        h += ih;
      });
      if (e.text?.trim()) {
        if (e.photos?.length) h += 26;
        const lines = wrapLines(measure, e.text.trim(), innerW);
        ops.push({ k: 'text', y: h, lines });
        h += lines.length * BODY_LH;
      }
      units.push({ ops, h });
    });
  });

  const HEADER_H = 220;
  const FOOT_H = 120;
  const pages = [];
  let cur = { units: [], h: HEADER_H };
  units.forEach(u => {
    if (cur.units.length && cur.h + u.h + FOOT_H > EX_PAGE_MAX) {
      pages.push(cur);
      cur = { units: [], h: 80 };
    }
    cur.units.push(u);
    cur.h += u.h;
  });
  pages.push(cur);

  const blobs = [];
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const H = Math.ceil(page.h + FOOT_H);
    const c = document.createElement('canvas');
    c.width = EX_W;
    c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, EX_W, H);
    ctx.textBaseline = 'top';

    let y;
    if (pi === 0) {
      ctx.fillStyle = accent;
      ctx.font = F.label;
      ctx.fillText('GAME DIARY', EX_PAD, 76);
      ctx.fillStyle = '#1A1A2E';
      ctx.font = F.title;
      ctx.fillText(rangeLabel, EX_PAD, 112);
      y = HEADER_H;
    } else {
      y = 80;
    }

    for (const u of page.units) {
      for (const op of u.ops) {
        const oy = y + op.y;
        if (op.k === 'date') {
          ctx.fillStyle = '#8E8E93';
          ctx.font = F.date;
          ctx.fillText(op.text, EX_PAD, oy);
        } else if (op.k === 'img') {
          ctx.save();
          roundRectPath(ctx, EX_PAD, oy, op.w, op.h, 28);
          ctx.clip();
          ctx.drawImage(op.img, EX_PAD, oy, op.w, op.h);
          ctx.restore();
        } else if (op.k === 'text') {
          ctx.fillStyle = '#1A1A2E';
          ctx.font = F.body;
          op.lines.forEach((ln, li) => ctx.fillText(ln, EX_PAD, oy + li * BODY_LH + 10));
        }
      }
      y += u.h;
    }

    ctx.fillStyle = '#C7C7CC';
    ctx.font = F.foot;
    const foot = pages.length > 1 ? `${pi + 1} / ${pages.length}` : '';
    if (foot) ctx.fillText(foot, EX_PAD, H - 72);

    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    if (!blob) throw new Error('이미지가 너무 커서 만들지 못했어요. 월별로 나눠서 내보내 보세요.');
    blobs.push(blob);
  }
  return blobs;
}

/* ── 컴포넌트 ── */
export default function GameDiary({ uid }) {
  const [entries, setEntries] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [month, setMonth] = useState('all');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(null); // { urls, blobs, name }
  const bottomRef = useRef(null);
  const didScroll = useRef(false);

  useEffect(() => onSnapshot(query(collection(db, COL), where('userId', '==', uid)), snap => {
    const d = [];
    snap.forEach(x => d.push({ id: x.id, ...x.data() }));
    setEntries(d);
    setLoaded(true);
  }, err => { console.error(err); setLoaded(true); }), [uid]);

  const sorted = [...entries]
    .filter(e => e.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : createdMs(a) - createdMs(b)));
  const months = [...new Set(sorted.map(e => e.date.slice(0, 7)))];
  const visible = month === 'all' ? sorted : sorted.filter(e => e.date.startsWith(month));
  const groups = groupByDate(visible);

  useEffect(() => {
    if (loaded && !didScroll.current && sorted.length) {
      didScroll.current = true;
      setTimeout(() => bottomRef.current?.scrollIntoView({ block: 'end' }), 50);
    }
  }, [loaded, sorted.length]);

  const scrollToBottom = () => setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 120);

  const doExport = async () => {
    if (!groups.length || exporting) return;
    setExporting(true);
    try {
      const first = groups[0].date, last = groups[groups.length - 1].date;
      const range = month !== 'all' ? fmtMonth(month)
        : first === last ? fmtDate(first).split(' ')[0]
        : `${first.replaceAll('-', '.')} – ${last.slice(5).replaceAll('-', '.')}`;
      const blobs = await renderDiaryImages(groups, range);
      const name = `game-diary_${month === 'all' ? `${first}_${last}` : month}`;
      setExported({ blobs, urls: blobs.map(b => URL.createObjectURL(b)), name });
    } catch (e) {
      alert(e.message || '내보내기 실패');
    }
    setExporting(false);
  };

  const closeExport = () => {
    exported?.urls.forEach(u => URL.revokeObjectURL(u));
    setExported(null);
  };

  return (
    <div className="diary px20">
      <div className="diary-toolbar">
        <select className="diary-month-select" value={month} onChange={e => setMonth(e.target.value)}>
          <option value="all">전체</option>
          {months.map(m => <option key={m} value={m}>{fmtMonth(m)}</option>)}
        </select>
        <button className="diary-export-btn" onClick={doExport} disabled={!groups.length || exporting}>
          {exporting ? '만드는 중…' : '🖼 이미지로 내보내기'}
        </button>
      </div>

      <div className="diary-feed">
        {loaded && groups.length === 0 && (
          <p className="diary-empty">아직 기록이 없어요.<br/>아래에서 사진이나 한 마디를 남겨보세요 ✍️</p>
        )}
        {groups.map(g => (
          <section key={g.date} className="diary-day">
            <div className="diary-date">{fmtDate(g.date)}</div>
            {g.items.map(e => <DiaryEntry key={e.id} entry={e} />)}
          </section>
        ))}
      </div>

      <DiaryComposer uid={uid} onSaved={scrollToBottom} />
      <div ref={bottomRef} />

      {exported && <ExportSheet data={exported} onClose={closeExport} />}
    </div>
  );
}

function AutoTextarea({ value, onChange, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} value={value} onChange={onChange} rows={2} {...rest} />;
}

function DiaryComposer({ uid, onSaved }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]); // [{ file, url }]
  const [date, setDate] = useState(localDateStr());
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const addFiles = e => {
    const picked = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    e.target.value = '';
    setFiles(prev => {
      const room = MAX_PHOTOS - prev.length;
      if (picked.length > room) alert(`사진은 한 번에 ${MAX_PHOTOS}장까지 붙일 수 있어요`);
      return [...prev, ...picked.slice(0, Math.max(0, room)).map(file => ({ file, url: URL.createObjectURL(file) }))];
    });
  };
  const removeFile = i => setFiles(prev => {
    URL.revokeObjectURL(prev[i].url);
    return prev.filter((_, j) => j !== i);
  });

  const submit = async () => {
    if (saving || (!text.trim() && !files.length)) return;
    setSaving(true);
    try {
      const photos = await compressAll(files.map(f => f.file), text.length);
      await addDoc(collection(db, COL), {
        date: date || localDateStr(),
        text: text.trim(),
        photos,
        createdAt: new Date(),
        userId: uid,
      });
      files.forEach(f => URL.revokeObjectURL(f.url));
      setFiles([]);
      setText('');
      setDate(localDateStr());
      onSaved?.();
    } catch (e) {
      console.error(e);
      alert('저장 실패: ' + (e.message || e));
    }
    setSaving(false);
  };

  const isToday = date === localDateStr();

  return (
    <div className="diary-composer">
      {files.length > 0 && (
        <div className="diary-previews">
          {files.map((f, i) => (
            <div key={f.url} className="diary-prev">
              <img src={f.url} alt="" />
              <button onClick={() => removeFile(i)} aria-label="사진 빼기">×</button>
            </div>
          ))}
        </div>
      )}
      <AutoTextarea
        className="diary-textarea"
        placeholder="오늘 게임 어땠어요? 몇 마디 남겨보세요"
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <div className="diary-composer-bar">
        <button className="diary-photo-btn" onClick={() => fileRef.current?.click()} disabled={files.length >= MAX_PHOTOS}>
          📷 <span>{files.length ? `${files.length}/${MAX_PHOTOS}` : '사진'}</span>
        </button>
        <label className={`diary-date-chip${isToday ? '' : ' custom'}`}>
          <span>{isToday ? '오늘' : fmtDate(date)}</span>
          <input type="date" value={date} max={localDateStr()} onChange={e => setDate(e.target.value || localDateStr())} />
        </label>
        <button className="diary-submit" onClick={submit} disabled={saving || (!text.trim() && !files.length)}>
          {saving ? '저장중…' : '기록'}
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={addFiles} />
    </div>
  );
}

function DiaryEntry({ entry }) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(entry.text || '');
  const [date, setDate] = useState(entry.date);
  const [photos, setPhotos] = useState(entry.photos || []);
  const [viewer, setViewer] = useState(null);

  const startEdit = () => {
    setText(entry.text || '');
    setDate(entry.date);
    setPhotos(entry.photos || []);
    setEditing(true);
    setMenu(false);
  };
  const save = async () => {
    if (!text.trim() && !photos.length) return remove();
    try {
      await updateDoc(doc(db, COL, entry.id), { text: text.trim(), date, photos });
      setEditing(false);
    } catch (e) { alert('수정 실패: ' + e.message); }
  };
  const remove = async () => {
    setMenu(false);
    if (!window.confirm('이 기록을 삭제할까요?')) return;
    try { await deleteDoc(doc(db, COL, entry.id)); } catch (e) { alert('삭제 실패: ' + e.message); }
  };

  if (editing) {
    return (
      <div className="diary-entry editing">
        {photos.length > 0 && (
          <div className="diary-previews">
            {photos.map((p, i) => (
              <div key={i} className="diary-prev">
                <img src={p} alt="" />
                <button onClick={() => setPhotos(photos.filter((_, j) => j !== i))} aria-label="사진 빼기">×</button>
              </div>
            ))}
          </div>
        )}
        <AutoTextarea className="diary-textarea" value={text} onChange={e => setText(e.target.value)} placeholder="내용" />
        <div className="diary-composer-bar">
          <label className="diary-date-chip custom">
            <span>{fmtDate(date)}</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value || entry.date)} />
          </label>
          <div style={{ flex: 1 }} />
          <button className="diary-ghost" onClick={() => setEditing(false)}>취소</button>
          <button className="diary-submit" onClick={save}>저장</button>
        </div>
      </div>
    );
  }

  return (
    <div className="diary-entry">
      <button className="diary-more" onClick={() => setMenu(v => !v)} aria-label="더보기">⋯</button>
      {menu && (
        <>
          <div className="diary-menu-backdrop" onClick={() => setMenu(false)} />
          <div className="diary-menu">
            <button onClick={startEdit}>수정</button>
            <button className="danger" onClick={remove}>삭제</button>
          </div>
        </>
      )}
      {(entry.photos || []).map((p, i) => (
        <img key={i} src={p} alt="" className="diary-photo" onClick={() => setViewer(p)} />
      ))}
      {entry.text && <p className="diary-text">{entry.text}</p>}
      {viewer && (
        <div className="diary-viewer" onClick={() => setViewer(null)}>
          <img src={viewer} alt="" />
        </div>
      )}
    </div>
  );
}

function ExportSheet({ data, onClose }) {
  const { blobs, urls, name } = data;
  const files = blobs.map((b, i) => new File([b], `${name}${blobs.length > 1 ? `_${i + 1}` : ''}.png`, { type: 'image/png' }));
  const canShare = typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files });

  const share = async () => {
    try { await navigator.share({ files }); }
    catch (e) { if (e.name !== 'AbortError') alert('공유 실패: ' + e.message); }
  };
  const download = () => {
    files.forEach((f, i) => {
      const a = document.createElement('a');
      a.href = urls[i];
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box diary-export-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>내보내기 {blobs.length > 1 ? `(${blobs.length}장)` : ''}</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body diary-export-preview">
          {blobs.length > 1 && <p className="diary-export-note">기록이 길어서 {blobs.length}장으로 나눠졌어요</p>}
          {urls.map(u => <img key={u} src={u} alt="일기 이미지" />)}
          <p className="diary-export-note">이미지를 길게 눌러서 바로 저장할 수도 있어요</p>
        </div>
        <div className="modal-footer">
          <div />
          <div>
            {canShare && <button className="btn-ghost" onClick={share}>공유 / 사진 저장</button>}
            <button className="btn-primary" onClick={download}>다운로드</button>
          </div>
        </div>
      </div>
    </div>
  );
}
