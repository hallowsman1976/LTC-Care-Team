import { useEffect, useRef, useState } from 'react';
import { signatureImage, type PreparedImage } from '../lib/images';

/** Draw-to-sign with finger, pen or mouse. Reports the signature as a PNG, or null when cleared. */
export function SignaturePad({ onChange, disabled = false }: { onChange: (image: PreparedImage | null) => void; disabled?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;
    const context = canvas.getContext('2d')!;
    context.scale(ratio, ratio);
    context.lineWidth = 2.5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#0f172a';
  }, []);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top] as const;
  };
  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const context = event.currentTarget.getContext('2d')!;
    const [x, y] = point(event);
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + 0.1, y + 0.1);
    context.stroke();
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext('2d')!;
    const [x, y] = point(event);
    context.lineTo(x, y);
    context.stroke();
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setEmpty(false);
    onChange(signatureImage(canvasRef.current!));
  };
  const clear = () => {
    const canvas = canvasRef.current!;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
    onChange(null);
  };

  return <div>
    <div className="relative">
      <canvas ref={canvasRef} aria-label="ช่องลงลายมือชื่อ" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
        className="h-44 w-full touch-none rounded-xl border-2 border-dashed border-slate-300 bg-white"/>
      {empty && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-slate-400">เซ็นชื่อในกรอบนี้</p>}
    </div>
    <button type="button" onClick={clear} disabled={disabled} className="mt-2 min-h-10 rounded-lg border border-slate-300 px-3 text-sm hover:bg-slate-50">ล้างลายเซ็น</button>
  </div>;
}
