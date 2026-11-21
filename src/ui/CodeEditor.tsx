import { useMemo, useRef, type KeyboardEvent } from 'react';
import { highlight, type CodeLang } from './highlight';

interface Props {
  value: string;
  lang: CodeLang;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  errorLine?: number;
  /** Highlighted line (debugger position). */
  activeLine?: number;
  label: string;
  minHeight?: number;
}

/** Textarea over a highlighted <pre>. Small, dependency-free and good enough for route files. */
export function CodeEditor({ value, lang, onChange, readOnly, errorLine, activeLine, label, minHeight }: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const html = useMemo(() => highlight(value, lang) + '\n', [value, lang]);
  const lines = useMemo(() => value.split('\n').length, [value]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && !e.shiftKey && onChange) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: en } = el;
      const next = value.slice(0, s) + '  ' + value.slice(en);
      onChange(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = s + 2;
      });
    }
  };

  return (
    <div className="editor" style={minHeight ? { minHeight } : undefined} onClick={() => ta.current?.focus()}>
      <div className="editor-inner">
        <div className="gutter" aria-hidden>
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className={errorLine === i + 1 ? 'err' : activeLine === i + 1 ? 'active' : undefined}>
              {i + 1}
            </div>
          ))}
        </div>
        <div className="code-area">
          <pre aria-hidden dangerouslySetInnerHTML={{ __html: html }} />
          <textarea
            ref={ta}
            aria-label={label}
            value={value}
            wrap="off"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            readOnly={readOnly || !onChange}
            onChange={(e) => onChange?.(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>
    </div>
  );
}
