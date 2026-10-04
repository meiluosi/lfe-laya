import { useEffect, useMemo, useRef, useState } from 'react';

export type Command = { id: string; label: string; hint?: string; run: () => void };
export function Palette({ open, commands, onClose }: { open: boolean; commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState(''), [cursor, setCursor] = useState(0), input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQuery(''); setCursor(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  const shown = useMemo(() => { const q = query.trim().toLowerCase(); return commands.filter(c => !q || c.label.toLowerCase().includes(q) || (c.hint ?? '').toLowerCase().includes(q)); }, [commands, query]);
  if (!open) return null;
  const choose = (c?: Command) => { if (!c) return; onClose(); c.run(); };
  return <div className="palette-back" onMouseDown={onClose}>
    <div className="palette" role="dialog" aria-label="命令面板" onMouseDown={e => e.stopPropagation()}>
      <input ref={input} value={query} placeholder="输入命令，如：重新播种、冻结、导出…" aria-label="搜索命令"
        onChange={e => { setQuery(e.target.value); setCursor(0); }}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowDown') { setCursor(c => Math.min(shown.length - 1, c + 1)); e.preventDefault(); }
          else if (e.key === 'ArrowUp') { setCursor(c => Math.max(0, c - 1)); e.preventDefault(); } else if (e.key === 'Enter') choose(shown[cursor]);
        }}/>
      <ul role="listbox">{shown.length ? shown.map((c, i) => <li key={c.id} role="option" aria-selected={i === cursor} className={i === cursor ? 'on' : ''} onMouseEnter={() => setCursor(i)} onClick={() => choose(c)}><span>{c.label}</span>{c.hint && <small>{c.hint}</small>}</li>) : <li className="none">没有匹配的命令</li>}</ul>
    </div>
  </div>;
}
