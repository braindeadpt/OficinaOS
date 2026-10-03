import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

interface SignaturePadProps {
  onChange: (dataUrl: string | null) => void;
}

/**
 * Lightweight signature capture on a canvas. The user draws with mouse,
 * pen or touch; clearing removes the stroke and resets the value. The
 * output is a PNG data URL stored on the cash session at close time.
 */
export default function SignaturePad({ onChange }: SignaturePadProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    // The canvas bitmap defaults to 300x150 — draw at devicePixelRatio and
    // size it to the rendered box so pointer coords map 1:1 to pixels.
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1b1b1f";
  }, []);

  function pos(e: React.PointerEvent<HTMLCanvasElement>): {
    x: number;
    y: number;
  } {
    const canvas = canvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const p = pos(e);
    drawingRef.current = true;
    lastRef.current = p;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) {
      return;
    }
    const ctx = canvasRef.current?.getContext("2d");
    const last = lastRef.current;
    if (!(ctx && last)) {
      return;
    }
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastRef.current = p;
    dirtyRef.current = true;
  }

  function end() {
    if (drawingRef.current && dirtyRef.current) {
      const dataUrl = canvasRef.current?.toDataURL("image/png") ?? null;
      onChange(dataUrl);
    }
    drawingRef.current = false;
    lastRef.current = null;
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!(canvas && ctx)) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    dirtyRef.current = false;
    onChange(null);
  }

  return (
    <div>
      <canvas
        className="h-32 w-full touch-none rounded-xl bg-surface-container-lowest outline outline-outline-variant"
        data-testid="signature-canvas"
        onPointerDown={start}
        onPointerLeave={end}
        onPointerMove={move}
        onPointerUp={end}
        ref={canvasRef}
      />
      <button
        className="mt-1 font-medium text-on-surface-variant text-xs hover:text-on-surface"
        onClick={clear}
        type="button"
      >
        {t("signature_clear")}
      </button>
    </div>
  );
}
