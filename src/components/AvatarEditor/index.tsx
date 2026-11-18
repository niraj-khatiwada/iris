import {
  Button,
  Description,
  Label,
  ListBox,
  Select,
  Switch,
} from '@heroui/react'
import {
  type BotAvatarGlasses,
  type BotAvatarHat,
  type BotAvatarShading,
  type BotAvatarType,
  botAvatarPalette,
  botAvatarShapes,
  botAvatarTypes,
} from 'bot-avatars'
import { Check, Palette } from 'lucide-react'
import type { ReactNode } from 'react'

import { DEFAULT_PRIMARY_COLOR } from '@/constants'
import { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/utils/tailwind'

const TYPE_LABELS: Record<BotAvatarType, string> = {
  clover: 'Clover',
  flower: 'Flower',
  triangle: 'Triangle',
  square: 'Square',
  blob: 'Blob',
  ghost: 'Ghost',
  circle: 'Circle',
  drop: 'Drop',
  star: 'Star',
  droid: 'Droid',
  mech: 'Mech',
  alien: 'Alien',
  hexagon: 'Hexagon',
  cat: 'Cat',
  cloud: 'Cloud',
  pill: 'Pill',
  pebble: 'Pebble',
  puddle: 'Puddle',
}

const BODY_COLORS: string[] = [
  '',
  '#7fb8f0',
  '#c49bf5',
  '#f39ac4',
  '#f2b94b',
  '#f08a72',
  '#e56f6a',
  '#82d7d0',
  '#b9c2d0',
  '#d7d7d7',
]

const ACCESSORY_COLORS: string[] = [
  '#27272b',
  '#f4f4f5',
  '#c9a24a',
  '#c4574e',
  '#4a6fa5',
  '#4f8a6d',
]

const SHADINGS: ReadonlyArray<{
  value: BotAvatarShading
  label: string
}> = [
  { value: 'fabric', label: 'Fabric' },
  { value: 'plastic', label: 'Plastic' },
  { value: 'crisp', label: 'Crisp' },
  { value: 'smooth', label: 'Smooth' },
  { value: 'flat', label: 'Flat' },
]

const HATS: ReadonlyArray<{ value: BotAvatarHat; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'beret', label: 'Beret' },
  { value: 'beanie', label: 'Beanie' },
  { value: 'party', label: 'Party' },
  { value: 'crown', label: 'Crown' },
]

const GLASSES: ReadonlyArray<{ value: BotAvatarGlasses; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'round', label: 'Round' },
  { value: 'square', label: 'Square' },
  { value: 'shades', label: 'Shades' },
]

const FACES = [
  { value: 'eyes', label: 'Eyes' },
  { value: 'mouth', label: 'Mouth' },
] as const

/** The live avatar editor shown in Settings → About. */
function AvatarEditor({ onDone }: { onDone?: () => void }) {
  const avatar = useSettingsStore((state) => state.avatar)
  const setAvatar = useSettingsStore((state) => state.setAvatar)
  const resetAvatar = useSettingsStore((state) => state.resetAvatar)
  const color = avatar.color || DEFAULT_PRIMARY_COLOR
  const customBodyColor =
    avatar.color !== '' && !BODY_COLORS.includes(avatar.color)
  const customAccessoryColor = !ACCESSORY_COLORS.includes(avatar.accessoryColor)

  return (
    <section className="mb-9">
      <h3 className="mb-2 text-[17px] font-semibold tracking-tight">Avatar</h3>
      <div className="divide-y divide-border/40 rounded-2xl border border-border/40 bg-surface/15 px-4">
        <EditorRow
          description="Pick the body shape. Iris keeps it everywhere."
          title="Body"
        >
          <div className="flex flex-wrap gap-2">
            {botAvatarTypes.map((type) => {
              const selected = avatar.type === type
              return (
                <button
                  key={type}
                  type="button"
                  aria-label={TYPE_LABELS[type]}
                  aria-pressed={selected}
                  className={cn(
                    'flex size-10 items-center justify-center rounded-xl border border-border/50 bg-surface/30 transition-colors hover:border-accent/40 hover:bg-surface/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    selected &&
                      'border-accent/60 bg-accent-soft shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]',
                  )}
                  title={TYPE_LABELS[type]}
                  onClick={() => setAvatar({ type })}
                >
                  <svg
                    aria-hidden
                    className="size-6 text-foreground/25"
                    viewBox="0 0 100 100"
                  >
                    <path
                      d={botAvatarShapes[type]}
                      fill={selected ? color : botAvatarPalette[type]}
                      stroke="currentColor"
                      strokeWidth={3}
                    />
                  </svg>
                </button>
              )
            })}
          </div>
        </EditorRow>

        <EditorRow
          description="The app accent follows this choice. Iris green is the default."
          title="Body colour"
        >
          <div className="flex flex-wrap items-center gap-2">
            {BODY_COLORS.map((value) => {
              const selected = avatar.color === value
              return (
                <button
                  key={value || 'iris-green'}
                  type="button"
                  aria-label={value ? `Body colour ${value}` : 'Iris green'}
                  aria-pressed={selected}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full border border-border/60 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                    selected &&
                      'ring-2 ring-foreground/70 ring-offset-2 ring-offset-background',
                  )}
                  style={{ backgroundColor: value || DEFAULT_PRIMARY_COLOR }}
                  title={value ? value : 'Iris green'}
                  onClick={() => setAvatar({ color: value })}
                >
                  {selected ? (
                    <Check className="size-3.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]" />
                  ) : null}
                </button>
              )
            })}

            <label
              className={cn(
                'relative flex size-8 items-center justify-center overflow-hidden rounded-full border border-border/60 text-muted transition-colors hover:text-foreground focus-within:ring-2 focus-within:ring-accent/50',
                customBodyColor &&
                  'border-accent/60 ring-2 ring-foreground/70 ring-offset-2 ring-offset-background',
              )}
              style={
                customBodyColor ? { backgroundColor: avatar.color } : undefined
              }
              title="Custom colour"
            >
              <input
                aria-label="Custom body colour"
                className="absolute inset-0 size-full cursor-default opacity-0"
                type="color"
                value={color}
                onChange={(event) => setAvatar({ color: event.target.value })}
              />
              <Palette
                className={cn(
                  'pointer-events-none size-3.5',
                  customBodyColor &&
                    'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]',
                )}
              />
            </label>
          </div>
        </EditorRow>

        <EditorRow
          description="Eyes alone, or eyes with a small mouth."
          title="Face"
        >
          <div className="inline-flex gap-0.5 rounded-full border border-border/50 bg-surface/40 p-0.5">
            {FACES.map((face) => (
              <button
                key={face.value}
                type="button"
                aria-pressed={avatar.face === face.value}
                className={cn(
                  'h-7 rounded-full px-3 text-[11px] font-medium text-muted transition-colors hover:text-foreground',
                  avatar.face === face.value &&
                    'bg-foreground/10 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]',
                )}
                onClick={() => setAvatar({ face: face.value })}
              >
                {face.label}
              </button>
            ))}
          </div>
        </EditorRow>

        <EditorRow
          description="How the body catches the light."
          title="Material"
        >
          <EditorSelect
            label="Avatar material"
            options={SHADINGS}
            value={avatar.shading}
            onChange={(shading) => setAvatar({ shading })}
          />
        </EditorRow>

        <EditorRow
          description="Small 3D pieces that turn with the head."
          title="Accessories"
        >
          <div className="flex flex-wrap gap-2">
            <EditorSelect
              label="Hat"
              options={HATS}
              value={avatar.hat}
              onChange={(hat) => setAvatar({ hat })}
            />
            <EditorSelect
              label="Glasses"
              options={GLASSES}
              value={avatar.glasses}
              onChange={(glasses) => setAvatar({ glasses })}
            />
          </div>
        </EditorRow>

        <div className="divide-y divide-border/40">
          <EditorSwitch
            description="A cup over each ear."
            title="Headphones"
            value={avatar.headphones}
            onChange={(headphones) => setAvatar({ headphones })}
          />
          <EditorSwitch
            description="A small bow under the face."
            title="Bow tie"
            value={avatar.bowTie}
            onChange={(bowTie) => setAvatar({ bowTie })}
          />
        </div>

        <EditorRow
          description="Colour of the hat, headphones, and bow tie."
          title="Accessory colour"
        >
          <div className="flex flex-wrap items-center gap-2">
            {ACCESSORY_COLORS.map((value) => {
              const selected = avatar.accessoryColor === value
              return (
                <button
                  key={value}
                  type="button"
                  aria-label={`Accessory colour ${value}`}
                  aria-pressed={selected}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full border border-border/60 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                    selected &&
                      'ring-2 ring-foreground/70 ring-offset-2 ring-offset-background',
                  )}
                  style={{ backgroundColor: value }}
                  title={value}
                  onClick={() => setAvatar({ accessoryColor: value })}
                >
                  {selected ? (
                    <Check className="size-3.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]" />
                  ) : null}
                </button>
              )
            })}

            <label
              className={cn(
                'relative flex size-8 items-center justify-center overflow-hidden rounded-full border border-border/60 text-muted transition-colors hover:text-foreground focus-within:ring-2 focus-within:ring-accent/50',
                customAccessoryColor &&
                  'border-accent/60 ring-2 ring-foreground/70 ring-offset-2 ring-offset-background',
              )}
              style={
                customAccessoryColor
                  ? { backgroundColor: avatar.accessoryColor }
                  : undefined
              }
              title="Custom accessory colour"
            >
              <input
                aria-label="Custom accessory colour"
                className="absolute inset-0 size-full cursor-default opacity-0"
                type="color"
                value={avatar.accessoryColor}
                onChange={(event) =>
                  setAvatar({ accessoryColor: event.target.value })
                }
              />
              <Palette
                className={cn(
                  'pointer-events-none size-3.5',
                  customAccessoryColor &&
                    'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]',
                )}
              />
            </label>
          </div>
        </EditorRow>

        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p className="text-xs leading-5 text-muted">
            The saved look applies everywhere Iris appears.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="ghost" onPress={resetAvatar}>
              Reset
            </Button>
            {onDone ? (
              <Button size="sm" variant="secondary" onPress={onDone}>
                Done
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}

function EditorRow({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="space-y-2.5 py-4">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted">{description}</p>
      </div>
      {children}
    </div>
  )
}

function EditorSwitch({
  title,
  description,
  value,
  onChange,
}: {
  title: string
  description: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <Switch className="w-full" isSelected={value} onChange={onChange}>
      <Switch.Content className="flex w-full items-center justify-between gap-8 py-3">
        <span className="min-w-0">
          <Label className="text-sm font-medium">{title}</Label>
          <Description className="mt-0.5 block text-xs leading-5 text-muted">
            {description}
          </Description>
        </span>
        <Switch.Control className="shrink-0">
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
  )
}

function EditorSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <Select
      aria-label={label}
      className="w-40"
      value={value}
      variant="secondary"
      onChange={(key) => {
        if (typeof key === 'string') {
          onChange(key as T)
        }
      }}
    >
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item
              key={option.value}
              id={option.value}
              textValue={option.label}
            >
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  )
}

AvatarEditor.displayName = 'AvatarEditor'

export default AvatarEditor
