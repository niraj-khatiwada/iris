const MODIFIER_KEYS = new Set([
  'Alt',
  'AltGraph',
  'CapsLock',
  'Control',
  'Fn',
  'Meta',
  'Shift',
])

const MODIFIER_LABELS: Record<string, string> = {
  commandorcontrol: '⌘',
  commandorctrl: '⌘',
  cmdorctrl: '⌘',
  cmdorcontrol: '⌘',
  command: '⌘',
  cmd: '⌘',
  super: '⌘',
  meta: '⌘',
  control: '⌃',
  ctrl: '⌃',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
}

const KEY_LABELS: Record<string, string> = {
  space: 'Space',
  enter: '↩',
  numpadenter: 'Num ↩',
  tab: '⇥',
  backspace: '⌫',
  delete: '⌦',
  escape: 'Esc',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  home: 'Home',
  end: 'End',
  pageup: 'Page Up',
  pagedown: 'Page Down',
  insert: 'Insert',
  comma: ',',
  period: '.',
  slash: '/',
  semicolon: ';',
  quote: "'",
  bracketleft: '[',
  bracketright: ']',
  backslash: '\\',
  minus: '-',
  equal: '=',
  backquote: '`',
  numpad0: 'Num 0',
  numpad1: 'Num 1',
  numpad2: 'Num 2',
  numpad3: 'Num 3',
  numpad4: 'Num 4',
  numpad5: 'Num 5',
  numpad6: 'Num 6',
  numpad7: 'Num 7',
  numpad8: 'Num 8',
  numpad9: 'Num 9',
  numpadadd: 'Num +',
  numpadsubtract: 'Num -',
  numpadmultiply: 'Num *',
  numpaddivide: 'Num /',
  numpaddecimal: 'Num .',
}

/** Human-readable label for a Tauri shortcut string. */
export function formatShortcut(shortcut: string): string {
  return shortcut
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase()
      return MODIFIER_LABELS[lower] ?? formatKeyFromCode(part)
    })
    .join(' ')
}

/** Human-readable label for a physical key code such as `KeyK` or `ArrowUp`. */
export function formatKeyFromCode(code: string): string {
  const lower = code.toLowerCase()
  if (/^key[a-z]$/.test(lower)) {
    return code.slice(3).toUpperCase()
  }
  if (/^digit\d$/.test(lower)) {
    return code.slice(5)
  }
  return KEY_LABELS[lower] ?? code.toUpperCase()
}

/**
 * Converts a keydown into Tauri shortcut syntax. Modifier-only presses and bare typing keys are
 * ignored so the recorder only produces a usable global shortcut.
 */
export function shortcutFromEvent(event: KeyboardEvent): string | null {
  if (event.repeat || MODIFIER_KEYS.has(event.key)) {
    return null
  }

  const key = keyFromCode(event.code)
  if (!key) {
    return null
  }

  const primaryModifier = event.metaKey || event.ctrlKey || event.altKey
  const functionKey = /^F([1-9]|1[0-2])$/i.test(key)
  if (!primaryModifier && !functionKey) {
    return null
  }

  const parts: string[] = []
  if (event.metaKey) {
    parts.push('CommandOrControl')
  }
  if (event.ctrlKey) {
    parts.push('Control')
  }
  if (event.altKey) {
    parts.push('Alt')
  }
  if (event.shiftKey) {
    parts.push('Shift')
  }
  parts.push(key)
  return parts.join('+')
}

function keyFromCode(code: string): string | null {
  if (
    /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2])|Numpad[0-9]|Numpad(Add|Subtract|Multiply|Divide|Decimal|Enter|Equal)|Space|Enter|Tab|Backspace|Delete|Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown|Insert|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Backslash|Minus|Equal|Backquote)$/.test(
      code,
    )
  ) {
    return code
  }
  return null
}
