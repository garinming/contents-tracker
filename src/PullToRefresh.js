import { useEffect, useRef, useState } from 'react';

/*
 * 화면 맨 위에서 아래로 당겼다 놓으면 새로고침.
 * (홈 화면에 추가한 PWA처럼 브라우저 새로고침이 없는 환경용)
 */
const THRESHOLD = 72;
const MAX_PULL = 110;

function canStartPull(target) {
  if (window.scrollY > 0) return false;
  let el = target;
  while (el && el !== document.body) {
    if (el.classList?.contains('modal-overlay') || el.classList?.contains('auth-overlay') || el.classList?.contains('diary-viewer')) return false;
    if (el.scrollTop > 0) return false;
    el = el.parentElement;
  }
  return true;
}

export default function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef(null);
  const pullRef = useRef(0);

  useEffect(() => {
    const onStart = e => {
      if (e.touches.length !== 1 || !canStartPull(e.target)) { start.current = null; return; }
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onMove = e => {
      if (!start.current) return;
      const dy = e.touches[0].clientY - start.current.y;
      const dx = Math.abs(e.touches[0].clientX - start.current.x);
      if (dy <= 0 || dx > dy) { pullRef.current = 0; setPull(0); return; }
      const p = Math.min(MAX_PULL, dy * 0.5);
      pullRef.current = p;
      setPull(p);
    };
    const onEnd = () => {
      if (!start.current) return;
      start.current = null;
      if (pullRef.current >= THRESHOLD) {
        setRefreshing(true);
        setPull(THRESHOLD);
        setTimeout(() => window.location.reload(), 250);
      } else {
        setPull(0);
      }
      pullRef.current = 0;
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  if (!pull && !refreshing) return null;
  const ready = pull >= THRESHOLD;
  return (
    <div className="ptr" style={{ transform: `translate(-50%, ${pull - 44}px)`, opacity: Math.min(1, pull / 40) }}>
      <span
        className={`ptr-icon${ready ? ' ready' : ''}${refreshing ? ' spin' : ''}`}
        style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
      >↻</span>
    </div>
  );
}
