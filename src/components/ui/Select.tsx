import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { useLauncherStore } from "../../stores";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * A themed, non-native dropdown.
 *
 * Native <select> popups are rendered by WebKitGTK as a separate overlay that
 * can fail to close and steal focus, blocking clicks on the UI underneath.
 * This component instead renders its menu through a portal on document.body
 * (so it is never clipped by `overflow: hidden` / stacking contexts) and
 * reliably collapses on selection or an outside click.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = "Select...",
  className = "",
  disabled = false,
}: SelectProps) {
  const { themeColors } = useLauncherStore();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ left: number; width: number; top?: number; bottom?: number }>({
    left: 0,
    width: 0,
  });

  const selected = options.find((o) => o.value === value);

  useLayoutEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const menuMax = 260;
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < menuMax && r.top > spaceBelow;
    setCoords({
      left: r.left,
      width: r.width,
      top: openUp ? undefined : r.bottom + 4,
      bottom: openUp ? window.innerHeight - r.top + 4 : undefined,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    // Reposition metadata can go stale while the page scrolls, so close when
    // the *page* scrolls. Crucially, ignore scroll events that originate from
    // inside the menu itself (the option list is scrollable) or the trigger,
    // otherwise scrolling through a long list would instantly close it.
    const onScroll = (e: Event) => {
      const t = e.target as Node | null;
      if (t && (menuRef.current?.contains(t) || triggerRef.current?.contains(t))) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-sm outline-none transition-all duration-200 ${
          disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
        } ${className}`}
        style={{
          background: themeColors.bg_card2,
          border: `1px solid ${open ? `${themeColors.accent}70` : themeColors.border}`,
          color: selected ? themeColors.text_main : themeColors.text_muted,
        }}
      >
        <span className="truncate text-left">{selected ? selected.label : placeholder}</span>
        <ChevronDown
          size={14}
          className="shrink-0 transition-transform duration-200"
          style={{ color: themeColors.text_muted, transform: open ? "rotate(180deg)" : "none" }}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[9999] max-h-64 overflow-y-auto rounded-xl py-1"
            style={{
              left: coords.left,
              width: coords.width,
              top: coords.top,
              bottom: coords.bottom,
              background: themeColors.bg_card,
              border: `1px solid ${themeColors.border}`,
              boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
            }}
          >
            {options.length === 0 && (
              <p className="px-3 py-2 text-xs" style={{ color: themeColors.text_muted }}>
                No options
              </p>
            )}
            {options.map((o) => {
              const active = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={o.disabled}
                  onClick={() => {
                    if (o.disabled) return;
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    o.disabled ? "opacity-40 cursor-not-allowed" : "hover:opacity-80"
                  }`}
                  style={{
                    color: active ? themeColors.accent : themeColors.text_main,
                    background: active ? `${themeColors.accent}15` : "transparent",
                  }}
                >
                  <span className="truncate">{o.label}</span>
                  {active && <Check size={13} className="shrink-0" />}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
