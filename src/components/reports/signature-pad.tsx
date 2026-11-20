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
    const dpr = window.devicePixelRatio || 1;
    // The bitmap must match the rendered box — pointer coords map 1:1 to
    // pixels. A one-shot measure races the parent <dialog>'s showModal():
    // child effects run first, the canvas is still display:none (0×0) and
    // the bitmap clamps to 1×1, silently clipping every stroke. A
    // ResizeObserver fires once layout gives the canvas a real size, and
    // again on later resizes — existing strokes are copied over scaled.
    const styleCtx = (ctx: CanvasRenderingContext2D) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1b1b1f";
    };
    const resize = (widthCss: number, heightCss: number) => {
      if (!(widthCss > 0 && heightCss > 0)) {
        return;
      }
      const w = Math.round(widthCss * dpr);
      const h = Math.round(heightCss * dpr);
      if (canvas.width === w && canvas.height === h) {
        return;
      }
      // Keep whatever was already drawn — a dialog opening or a rotation
      // must not erase a half-finished signature.
      const prev = document.createElement("canvas");
      prev.width = canvas.width;
      prev.height = canvas.height;
      prev.getContext("2d")?.drawImage(canvas, 0, 0);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }
      styleCtx(ctx);
      if (prev.width > 1 && prev.height > 1) {
        ctx.drawImage(prev, 0, 0, widthCss, heightCss);
      }
    };
    if (typeof ResizeObserver === "undefined") {
      // Test environments without layout — measure once as before.
      const rect = canvas.getBoundingClientRect();
      resize(rect.width, rect.height);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        resize(rect.width, rect.height);
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
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
