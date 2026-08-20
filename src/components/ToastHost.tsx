import { useEffect, useState } from "react";
import { TOAST_EVENT, type ToastEventDetail } from "../lib/toast";

interface ToastItem extends ToastEventDetail {
  id: number;
}

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<ToastEventDetail>).detail;
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { ...detail, id }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2600);
    }
    window.addEventListener(TOAST_EVENT, handler);
    return () => window.removeEventListener(TOAST_EVENT, handler);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
