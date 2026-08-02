"use client";

import { useEffect, type ReactNode } from "react";

/* --------------------------------------------------------------------------
   Icons — inline so the app ships with no icon dependency or network fetch.
   -------------------------------------------------------------------------- */

type IconProps = { className?: string };

function svg(path: ReactNode, extra?: { fill?: boolean }) {
  return function Icon({ className = "size-4" }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill={extra?.fill ? "currentColor" : "none"}
        stroke={extra?.fill ? "none" : "currentColor"}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {path}
      </svg>
    );
  };
}

export const IconFolder = svg(
  <path d="M3 7a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.6.8l.9 1.2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
);
export const IconFile = svg(
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </>,
);
export const IconCube = svg(
  <>
    <path d="M12 2.8 20 7v10l-8 4.2L4 17V7z" />
    <path d="M4 7l8 4.2L20 7M12 11.2V21" />
  </>,
);
export const IconChevronRight = svg(<path d="m9 6 6 6-6 6" />);
export const IconChevronDown = svg(<path d="m6 9 6 6 6-6" />);
export const IconSearch = svg(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>,
);
export const IconPlus = svg(<path d="M12 5v14M5 12h14" />);
export const IconTrash = svg(
  <>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
  </>,
);
export const IconSave = svg(
  <>
    <path d="M5 3h11l3 3v15H5z" />
    <path d="M8 3v6h7V3M8 21v-7h8v7" />
  </>,
);
export const IconSparkles = svg(
  <>
    <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
    <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
  </>,
);
export const IconSettings = svg(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 14a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.7-2.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3a2 2 0 1 1 4 0 1.6 1.6 0 0 0 2.6 1.7l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 21 10a2 2 0 1 1 0 4 1.6 1.6 0 0 0-1.6 1z" />
  </>,
);
export const IconRefresh = svg(
  <>
    <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
    <path d="M21 4v4h-4M21 12a9 9 0 0 1-15.5 6.2L3 16" />
    <path d="M3 20v-4h4" />
  </>,
);
export const IconCheck = svg(<path d="m5 13 4 4L19 7" />);
export const IconAlert = svg(
  <>
    <path d="M12 3.5 21 20H3z" />
    <path d="M12 10v4M12 17h.01" />
  </>,
);
export const IconDownload = svg(
  <>
    <path d="M12 4v11M8 12l4 4 4-4" />
    <path d="M4 20h16" />
  </>,
);
export const IconClose = svg(<path d="M6 6l12 12M18 6 6 18" />);
export const IconWand = svg(
  <>
    <path d="M4 20 16 8" />
    <path d="M15 3v4M21 9h-4M18.5 4.5 16 7M6 12l6 6" />
  </>,
);
export const IconUndo = svg(
  <>
    <path d="M9 10H5V6" />
    <path d="M5 10a8 8 0 1 1 2.3 7" />
  </>,
);

/* --------------------------------------------------------------------------
   Primitives
   -------------------------------------------------------------------------- */

export function Spinner({ className = "size-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`animate-spin ${className}`} aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        opacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Banner({
  tone = "error",
  children,
  onDismiss,
}: {
  tone?: "error" | "success" | "info";
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const tones = {
    error: "border-danger/40 bg-danger/10 text-danger",
    success: "border-success/40 bg-success/10 text-success",
    info: "border-info/40 bg-info/10 text-info",
  } as const;

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${tones[tone]}`}
    >
      <span className="mt-0.5 shrink-0">
        {tone === "success" ? <IconCheck /> : <IconAlert />}
      </span>
      <div className="min-w-0 flex-1 break-words">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 opacity-70 hover:opacity-100"
          aria-label="Dismiss"
        >
          <IconClose className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon && <div className="text-faint">{icon}</div>}
      <p className="text-sm font-medium text-content">{title}</p>
      {hint && <p className="max-w-md text-sm text-muted">{hint}</p>}
      {action}
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = "max-w-lg",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 p-4 sm:items-center">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`card relative z-10 w-full ${width} shadow-[var(--app-shadow)]`}
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost rounded p-1 hover:text-content"
            aria-label="Close dialog"
          >
            <IconClose />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-3">
      <span className="label">{label}</span>
      {children}
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1 text-sm">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-5 w-9 shrink-0 rounded-full border transition ${
          checked ? "border-accent bg-accent" : "border-line-strong bg-canvas"
        }`}
      >
        <span
          className={`block size-3.5 rounded-full bg-canvas transition ${
            checked ? "translate-x-4.5 bg-accent-contrast" : "translate-x-0.5 bg-faint"
          }`}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-content">{label}</span>
        {hint && <span className="block text-xs text-faint">{hint}</span>}
      </span>
    </label>
  );
}
