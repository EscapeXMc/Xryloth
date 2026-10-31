import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, HelpCircle, Info, X } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Custom dialog system — replaces native alert() / confirm() / prompt() */
/*  Promise-based API usable from anywhere (even outside React).        */
/* ------------------------------------------------------------------ */

type DialogKind = "confirm" | "prompt" | "alert";

interface DialogRequest {
  id: number;
  kind: DialogKind;
  title: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (value: any) => void;
}

let seq = 0;
let current: DialogRequest | null = null;
let listener: ((d: DialogRequest | null) => void) | null = null;

function emit() {
  listener?.(current);
}

function request(kind: DialogKind, title: string, message: string, opts?: {
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<any> {
  return new Promise((resolve) => {
    current = {
      id: ++seq,
      kind,
      title,
      message,
      placeholder: opts?.placeholder,
      defaultValue: opts?.defaultValue,
      confirmLabel: opts?.confirmLabel,
      cancelLabel: opts?.cancelLabel,
      danger: opts?.danger,
      resolve,
    };
    emit();
  });
}

/** Replaces window.confirm — resolves true/false. */
export function confirmDialog(title: string, message: string, opts?: {
  confirmLabel?: string; cancelLabel?: string; danger?: boolean;
}): Promise<boolean> {
  return request("confirm", title, message, opts);
}

/** Replaces window.prompt — resolves the typed string, or null if cancelled. */
export function promptDialog(title: string, message: string, opts?: {
  placeholder?: string; defaultValue?: string; confirmLabel?: string;
}): Promise<string | null> {
  return request("prompt", title, message, opts);
}

/** Replaces window.alert — resolves when dismissed. */
export function alertDialog(title: string, message: string, opts?: {
  confirmLabel?: string;
}): Promise<void> {
  return request("alert", title, message, opts).then(() => undefined);
}

function settle(value: any) {
  const d = current;
  if (!d) return;
  current = null;
  emit();
  d.resolve(value);
}

/* ------------------------------------------------------------------ */
/*  DialogHost — renders the active dialog. Mount once near the root.  */
/* ------------------------------------------------------------------ */

export function DialogHost() {
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [input, setInput] = useState("");

  useEffect(() => {
    listener = setDialog;
    return () => { listener = null; };
  }, []);

  useEffect(() => {
    if (dialog?.kind === "prompt") setInput(dialog.defaultValue || "");
  }, [dialog]);

  // Close on Escape
  useEffect(() => {
    if (!dialog) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); settle(dialog.kind === "prompt" ? null : false); }
      if (e.key === "Enter" && dialog.kind === "prompt") { settle(input); }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [dialog, input]);

  const isDanger = dialog?.danger;
  const icon = dialog?.kind === "alert" ? <Info size={20} />
    : dialog?.kind === "prompt" ? <HelpCircle size={20} />
    : isDanger ? <AlertTriangle size={20} /> : <HelpCircle size={20} />;
  const accent = isDanger ? "#ef4444" : dialog?.kind === "alert" ? "#3b82f6" : "#e06b22";

  return (
    <AnimatePresence>
      {dialog && (
        <motion.div
          key={dialog.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[10000] flex items-center justify-center"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => settle(dialog.kind === "prompt" ? null : false)}
          />

          {/* Dialog card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 12 }}
            transition={{ type: "spring", damping: 26, stiffness: 340 }}
            className="relative w-full max-w-sm mx-4 rounded-2xl overflow-hidden"
            style={{
              background: "#13161C",
              border: `1px solid ${accent}30`,
              boxShadow: `0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px ${accent}10`,
            }}
          >
            {/* Header */}
            <div className="flex items-start gap-3 p-5 pb-3">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${accent}15`, color: accent }}
              >
                {icon}
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <h3 className="text-sm font-bold text-white leading-tight">{dialog.title}</h3>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed whitespace-pre-wrap break-words">{dialog.message}</p>
              </div>
              <button
                onClick={() => settle(dialog.kind === "prompt" ? null : false)}
                className="p-1 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-colors shrink-0"
              >
                <X size={14} />
              </button>
            </div>

            {/* Prompt input */}
            {dialog.kind === "prompt" && (
              <div className="px-5 pb-1">
                <input
                  autoFocus
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") settle(input); e.stopPropagation(); }}
                  placeholder={dialog.placeholder}
                  className="w-full px-3 py-2.5 rounded-xl text-xs outline-none text-white placeholder-zinc-600"
                  style={{ background: "#0D0F12", border: "1px solid rgba(255,255,255,0.08)" }}
                />
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 p-5 pt-4">
              {dialog.kind !== "alert" && (
                <button
                  onClick={() => settle(dialog.kind === "prompt" ? null : false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                >
                  {dialog.cancelLabel || "Cancel"}
                </button>
              )}
              <button
                autoFocus
                onClick={() => settle(dialog.kind === "prompt" ? input : true)}
                className="px-4 py-2 rounded-xl text-xs font-bold transition-all"
                style={{
                  background: isDanger ? "#ef4444" : accent,
                  color: "#fff",
                  boxShadow: `0 4px 16px ${accent}40`,
                }}
              >
                {dialog.confirmLabel || (dialog.kind === "prompt" ? "Confirm" : dialog.kind === "alert" ? "OK" : "Confirm")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
