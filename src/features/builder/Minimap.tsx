import { useEffect, useRef, useState, type RefObject } from 'react';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const WIDTH = 170;

/** Overview of the whole canvas; click or drag to move the viewport. */
export function Minimap({ canvas, version }: { canvas: RefObject<HTMLElement | null>; version: unknown }) {
  const [state, setState] = useState<{ scale: number; height: number; lanes: Box[]; view: Box }>();
  const dragging = useRef(false);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const W = el.scrollWidth;
        const H = el.scrollHeight;
        if (W <= el.clientWidth + 4 && H <= el.clientHeight + 4) return setState(undefined);
        const scale = WIDTH / W;
        const origin = el.getBoundingClientRect();
        const lanes = [...el.querySelectorAll<HTMLElement>('.lane')].map((l) => {
          const r = l.getBoundingClientRect();
          const flow = l.querySelector<HTMLElement>('.flow, .rest-ops, .bean-list, .config-body');
          const fr = flow?.getBoundingClientRect() ?? r;
          return { x: (fr.left - origin.left + el.scrollLeft) * scale, y: (r.top - origin.top + el.scrollTop) * scale, w: Math.max(4, fr.width * scale), h: Math.max(3, r.height * scale) };
        });
        setState({ scale, height: Math.min(140, H * scale), lanes, view: { x: el.scrollLeft * scale, y: el.scrollTop * scale, w: el.clientWidth * scale, h: el.clientHeight * scale } });
      });
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [canvas, version]);

  if (!state) return null;
  const go = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = canvas.current;
    if (!el) return;
    const r = e.currentTarget.getBoundingClientRect();
    el.scrollLeft = (e.clientX - r.left) / state.scale - el.clientWidth / 2;
    el.scrollTop = (e.clientY - r.top) / state.scale - el.clientHeight / 2;
  };
  return (
    <div
      className="minimap"
      style={{ width: WIDTH, height: state.height }}
      role="img"
      aria-label="Canvas overview — click to navigate"
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        go(e);
      }}
      onPointerMove={(e) => dragging.current && go(e)}
      onPointerUp={() => (dragging.current = false)}
    >
      {state.lanes.map((l, i) => (
        <span key={i} className="mm-lane" style={{ left: l.x, top: l.y, width: l.w, height: l.h }} />
      ))}
      <span className="mm-view" style={{ left: state.view.x, top: state.view.y, width: state.view.w, height: state.view.h }} />
    </div>
  );
}
