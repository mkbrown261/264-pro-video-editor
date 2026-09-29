import { useEffect, useRef, useState } from "react";

export type FileMenuEntry = { icon: string; label: string; kbd?: string; onSelect: () => void } | "sep";

/** The menubar's File dropdown; closes on selection or a click outside. */
export function FileMenu({ entries }: { entries: FileMenuEntry[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="file-menu-wrapper" ref={ref}>
      <button
        className={`menubar-action-btn file-menu-btn${open ? " active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="File"
        type="button"
      >
        File ▾
      </button>
      {open && (
        <div className="file-menu-dropdown">
          {entries.map((e, i) => e === "sep"
            ? <div className="file-menu-sep" key={`sep${i}`} />
            : (
              <button className="file-menu-item" key={e.label} onClick={() => { setOpen(false); e.onSelect(); }} type="button">
                <span className="fmi-icon">{e.icon}</span> {e.label}{e.kbd && <> <span className="fmi-kbd">{e.kbd}</span></>}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
