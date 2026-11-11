import { useEffect, useRef, type MutableRefObject } from 'react';
import { engine } from '@/sense/session';
import { detrend, normalizeTrace } from '@/sense/signalMath';
import type { TracePoint } from '@/sense/types';
import { guideLevel, isInhaling } from './pacer';

export interface BreathCanvasProps {
  /** 'listen': the orb follows the user's own breath. 'guide': the orb leads, a ring shows the user. */
  mode: 'listen' | 'guide';
  getPace: () => number | null;
  phaseRef: MutableRefObject<number>;
  guideHistory: MutableRefObject<TracePoint[]>;
  signRef: MutableRefObject<1 | -1>;
  onPhaseChange?: (inhaling: boolean) => void;
}

const BREATH = [45, 214, 196];
const HEART = [251, 113, 133];
const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export function BreathCanvas({ mode, getPace, phaseRef, guideHistory, signRef, onPhaseChange }: BreathCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ mode, getPace, onPhaseChange });
  propsRef.current = { mode, getPace, onPhaseChange };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    let userLevel = 0;
    let beatPhase = 0;
    let inhaling: boolean | null = null;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const { mode: m, getPace: pace, onPhaseChange: flip } = propsRef.current;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) * 0.36;

      // Guide phase advances at the current pace.
      let level = 0;
      const p = pace();
      if (m === 'guide' && p) {
        phaseRef.current += (dt / 1000) * (p / 60);
        level = guideLevel(phaseRef.current);
        const history = guideHistory.current;
        history.push({ t: engine.nowMs(), v: level });
        while (history.length && history[0].t < engine.nowMs() - 40_000) history.shift();
        const inh = isInhaling(phaseRef.current);
        if (inh !== inhaling) {
          inhaling = inh;
          flip?.(inh);
        }
      }

      // The user's own breath, from the SDK chest-movement trace.
      const chest = engine.getChest(12_000);
      let hasUser = false;
      if (chest.length > 40) {
        const norm = normalizeTrace(detrend(chest, 8000));
        const target = Math.max(-1, Math.min(1, norm[norm.length - 1].v * signRef.current));
        userLevel += (target - userLevel) * Math.min(1, dt / 120);
        hasUser = true;
      }

      // Heartbeat halo at the live pulse rate.
      const pulse = engine.getState().pulse?.value ?? null;
      let glow = 0;
      if (pulse) {
        beatPhase += (dt / 1000) * (pulse / 60);
        glow = Math.exp(-(beatPhase % 1) * 5);
      }

      ctx.clearRect(0, 0, w, h);

      if (pulse) {
        const halo = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.45);
        halo.addColorStop(0, rgba(HEART, 0.05 + glow * 0.24));
        halo.addColorStop(1, rgba(HEART, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 1.45, 0, Math.PI * 2);
        ctx.fill();
      }

      const radiusFor = (lv: number) => R * (0.5 + 0.45 * ((lv + 1) / 2));
      const orbLevel = m === 'guide' ? level : hasUser ? userLevel : Math.sin(now / 1600) * 0.15;
      const orbR = radiusFor(orbLevel);
      const fill = ctx.createRadialGradient(cx, cy - orbR * 0.3, orbR * 0.1, cx, cy, orbR);
      fill.addColorStop(0, rgba(BREATH, m === 'guide' ? 0.55 : 0.35));
      fill.addColorStop(1, rgba(BREATH, m === 'guide' ? 0.12 : 0.06));
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(cx, cy, orbR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(BREATH, 0.5);
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (m === 'guide' && hasUser) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([2, 7]);
        ctx.beginPath();
        ctx.arc(cx, cy, radiusFor(userLevel), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [phaseRef, guideHistory, signRef]);

  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden />;
}
