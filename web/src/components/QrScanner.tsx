import { XIcon } from "@phosphor-icons/react";
import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";

/**
 * Full-screen camera that reads a QR code, for pairing the phone with the PC. Uses the camera from the page
 * (getUserMedia; Android asks for the camera permission the first time) and decodes frames with jsQR, so no native
 * scanner or Google Play services are needed. Calls `onCode` once with the text of the first QR code it sees.
 */
export function QrScanner({ onCode, onClose }: { onCode: (text: string) => void; onClose: () => void }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let done = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const scan = () => {
      const v = video.current;
      if (done || !v || !ctx) return;
      if (v.readyState >= v.HAVE_CURRENT_DATA && v.videoWidth) {
        // A smaller copy is plenty for a QR code on a screen, and much quicker to read.
        const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "attemptBoth" });
        if (found?.data) {
          done = true;
          onCode(found.data);
          return;
        }
      }
      timer = window.setTimeout(scan, 200);
    };

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (done) return;
        const v = video.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play().catch(() => {});
        scan();
      } catch {
        setError(t.sync.cameraDenied);
      }
    })();

    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      done = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      window.removeEventListener("keydown", onKey);
    };
  }, [onCode, onClose, t]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t.sync.scan} data-escape-closes className="safe-top safe-bottom fixed inset-0 z-[80] flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <p className="font-semibold">{t.sync.scan}</p>
        <button type="button" onClick={onClose} aria-label={t.common.cancel} className="grid size-10 place-items-center rounded-full bg-white/10">
          <XIcon size={18} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <video ref={video} playsInline muted className="size-full object-cover" />
        {/* The frame to aim with. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="aspect-square w-[min(70vw,320px)] rounded-[24px] shadow-[0_0_0_9999px_rgb(0_0_0/0.45)] ring-2 ring-white/80" />
        </div>
      </div>
      <p className="px-6 py-5 text-center text-sm text-white/80">{error ?? t.sync.scanHint}</p>
    </div>,
    document.body,
  );
}
