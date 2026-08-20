export type ToastKind = "success" | "error";

export interface ToastEventDetail {
  message: string;
  kind: ToastKind;
}

export const TOAST_EVENT = "app-toast";

export function toast(message: string, kind: ToastKind = "success") {
  window.dispatchEvent(new CustomEvent<ToastEventDetail>(TOAST_EVENT, { detail: { message, kind } }));
}
