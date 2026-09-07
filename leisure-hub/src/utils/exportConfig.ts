import {
  globalKey,
  keyForProfile,
  activeProfileEntry,
  listProfiles,
  setActiveProfile,
  upsertProfilesByUuid,
} from '@/utils/profileKey'
import {
  PROFILE_NAME_MAX,
  isProfilePreset,
  type ProfileEntry,
  type ProfilePreset,
} from '@/types/profile'
import type { SettingsState } from '@/stores/settings'
import { GRID_SCHEMA_VERSION, type GridState, type Tile } from '@/types/tile'
import { isUuid } from '@/utils/uuid'

export const CONFIG_EXPORT_VERSION = 1

type JsonObject = Record<string, unknown>

const CONFIG_FORMAT = 'leisure-hub-config'
const IMPORT_MAX_PROFILES = 1000
const IMPORT_MAX_GRID_SLOTS = 20_000

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function convertGrid(raw: unknown): JsonObject | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as JsonObject
  const columns = typeof source.cols === 'number' ? source.cols : 0
  const rows = typeof source.rows === 'number' ? source.rows : 0
  const slots = Array.isArray(source.slots) ? source.slots : []
  const seen = new Set<string>()
  const tiles = slots.flatMap((value, index) => {
    if (!value || typeof value !== 'object' || !columns) return []
    const tile = value as Tile
    if (typeof tile.id !== 'string' || !tile.id) return []
    if (seen.has(tile.id)) return []
    seen.add(tile.id)
    const spanW = Number.isInteger(tile.spanW) ? Math.max(1, Math.trunc(tile.spanW as number)) : 1
    const spanH = Number.isInteger(tile.spanH) ? Math.max(1, Math.trunc(tile.spanH as number)) : 1
    const anchorX = index % columns
    const anchorY = Math.floor(index / columns)
    return [
      {
        ...tile,
        // Coordinates identify the last occupied cell, so covered null slots
        // never need to be serialized and large tiles remain unambiguous.
        x: Math.min(columns, Math.max(1, anchorX + spanW)),
        y: Math.min(rows || anchorY + spanH, Math.max(1, anchorY + spanH)),
      },
    ]
  })
  const recycleBin = Array.isArray(source.overflow)
    ? source.overflow
        .filter((value): value is Tile => Boolean(value && typeof value === 'object'))
        .map((value) => ({
          ...value,
          reason: value.recycleReason === 'deleted' ? '主动删除' : '格子不够放',
        }))
    : []
  return {
    version: source.version,
    columns,
    rows: source.rows,
    coordinateBase: 1,
    coordinatePoint: 'bottom-right',
    tiles,
    recycleBin,
  }
}

function convertSettings(raw: unknown): JsonObject | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as JsonObject
  return {
    version: source.version,
    background: {
      mode: source.bgMode,
      colors: source.bgColors,
      localImages: source.bgLocalImages,
      urls: source.bgUrls,
      rotate: source.bgRotate,
      intervalSeconds: source.bgInterval,
      selected: source.bgPick,
      blur: source.bgBlur,
    },
    motion: source.motion,
    glass: source.glass,
    themeColor: source.themeColor,
    scrimOpacity: source.scrimOpacity,
    drawerSide: source.drawerSide,
    closeOnScrim: source.closeOnScrim,
    handleRatio: source.handleRatio,
    area: {
      mode: source.areaMode,
      width: source.areaWidth,
      height: source.areaHeight,
      columns: source.areaCols,
      rows: source.areaRows,
    },
  }
}

function profileExport(entry: ProfileEntry): JsonObject {
  return {
    uuid: entry.uuid,
    name: entry.name,
    preset: entry.preset,
    grid: convertGrid(readJson(keyForProfile('grid', entry.id))),
    settings: convertSettings(readJson(keyForProfile('settings', entry.id))),
  }
}

/** Build a portable snapshot while translating storage-only field names to export names. */
export function buildConfigExport(): JsonObject {
  const active = activeProfileEntry()
  return {
    format: CONFIG_FORMAT,
    version: CONFIG_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    activeProfileUuid: active.uuid,
    profiles: listProfiles().map(profileExport),
    global: readJson(globalKey('global')),
    todos: readJson(globalKey('todos')) ?? [],
    searchHistory: readJson(globalKey('search-history')) ?? [],
  }
}

interface ImportedProfile {
  uuid: string
  name: string
  preset: ProfilePreset
  grid: GridState | null
  settings: SettingsState | null
}

export interface ParsedConfigImport {
  activeProfileUuid: string
  profiles: ImportedProfile[]
  global: JsonObject | null
  todos: unknown[]
  searchHistory: unknown[]
}

function invalid(message: string): never {
  throw new Error(`配置文件无效：${message}`)
}

function recordOf(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} 不是对象`)
  return value as JsonObject
}

function stringOf(value: unknown, label: string): string {
  if (typeof value !== 'string') invalid(`${label} 不是字符串`)
  return value
}

function nonEmptyStringOf(value: unknown, label: string): string {
  const text = stringOf(value, label)
  if (!text) invalid(`${label} 为空`)
  return text
}

function numberOf(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${label} 不是有效数字`)
  return value
}

function booleanOf(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') invalid(`${label} 不是布尔值`)
  return value
}

function positiveIntegerOf(value: unknown, label: string): number {
  const number = numberOf(value, label)
  if (!Number.isInteger(number) || number <= 0) invalid(`${label} 必须是正整数`)
  return number
}

function arrayOf(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${label} 不是数组`)
  return value
}

function choiceOf<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) invalid(`${label} 不被支持`)
  return value as T
}

function stringArrayOf(value: unknown, label: string): string[] {
  return arrayOf(value, label).map((item, index) => stringOf(item, `${label}[${index}]`))
}

function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : positiveIntegerOf(value, label)
}

function importedTile(value: unknown, label: string, recycle: boolean): Tile {
  const source = recordOf(value, label)
  const id = nonEmptyStringOf(source.id, `${label}.id`)
  const name = stringOf(source.name, `${label}.name`)
  const kind = choiceOf(source.kind, ['link', 'widget'] as const, `${label}.kind`)
  const spanW = optionalPositiveInteger(source.spanW, `${label}.spanW`)
  const spanH = optionalPositiveInteger(source.spanH, `${label}.spanH`)
  const next: JsonObject = { ...source, id, name, kind }

  delete next.x
  delete next.y
  delete next.reason
  if (spanW === undefined) delete next.spanW
  else next.spanW = spanW
  if (spanH === undefined) delete next.spanH
  else next.spanH = spanH

  if (kind === 'link') stringOf(source.url, `${label}.url`)
  else nonEmptyStringOf(source.widgetId, `${label}.widgetId`)

  if (recycle) {
    const reason = choiceOf(source.reason, ['主动删除', '格子不够放'] as const, `${label}.reason`)
    next.recycleReason = reason === '主动删除' ? 'deleted' : 'capacity'
  } else {
    delete next.recycleReason
    delete next.recycleOrigin
  }

  return next as unknown as Tile
}

function importedGrid(value: unknown, label: string): GridState | null {
  if (value === null) return null
  const source = recordOf(value, label)
  if (source.version !== GRID_SCHEMA_VERSION) invalid(`${label}.version 不被支持`)
  if (source.coordinateBase !== 1 || source.coordinatePoint !== 'bottom-right') {
    invalid(`${label} 的坐标系不被支持`)
  }

  const cols = positiveIntegerOf(source.columns, `${label}.columns`)
  const rows = positiveIntegerOf(source.rows, `${label}.rows`)
  const slotCount = cols * rows
  if (!Number.isSafeInteger(slotCount) || slotCount > IMPORT_MAX_GRID_SLOTS) {
    invalid(`${label} 的网格过大`)
  }

  const slots: (Tile | null)[] = Array.from({ length: slotCount }, () => null)
  const occupied = new Uint8Array(slotCount)
  const tileIds = new Set<string>()
  const tiles = arrayOf(source.tiles, `${label}.tiles`)

  for (let index = 0; index < tiles.length; index++) {
    const tileLabel = `${label}.tiles[${index}]`
    const raw = recordOf(tiles[index], tileLabel)
    const tile = importedTile(raw, tileLabel, false)
    if (tileIds.has(tile.id)) invalid(`${tileLabel}.id 重复`)
    tileIds.add(tile.id)

    const x = positiveIntegerOf(raw.x, `${tileLabel}.x`)
    const y = positiveIntegerOf(raw.y, `${tileLabel}.y`)
    const width = tile.spanW ?? 1
    const height = tile.spanH ?? 1
    const col = x - width
    const row = y - height
    if (col < 0 || row < 0 || x > cols || y > rows) invalid(`${tileLabel} 超出网格边界`)

    for (let offsetY = 0; offsetY < height; offsetY++) {
      for (let offsetX = 0; offsetX < width; offsetX++) {
        const occupiedIndex = (row + offsetY) * cols + col + offsetX
        if (occupied[occupiedIndex]) invalid(`${tileLabel} 与其它方格重叠`)
        occupied[occupiedIndex] = 1
      }
    }
    slots[row * cols + col] = tile
  }

  const overflow = arrayOf(source.recycleBin, `${label}.recycleBin`).map((item, index) => {
    const tile = importedTile(item, `${label}.recycleBin[${index}]`, true)
    if (tileIds.has(tile.id)) invalid(`${label}.recycleBin[${index}].id 重复`)
    tileIds.add(tile.id)
    return tile
  })

  return { version: GRID_SCHEMA_VERSION, cols, rows, slots, overflow }
}

function importedSettings(value: unknown, label: string): SettingsState | null {
  if (value === null) return null
  const source = recordOf(value, label)
  if (source.version !== 1) invalid(`${label}.version 不被支持`)
  const background = recordOf(source.background, `${label}.background`)
  const area = recordOf(source.area, `${label}.area`)
  const rotate = recordOf(background.rotate, `${label}.background.rotate`)
  const intervals = recordOf(background.intervalSeconds, `${label}.background.intervalSeconds`)
  const selected = recordOf(background.selected, `${label}.background.selected`)

  const bgLocalImages = arrayOf(background.localImages, `${label}.background.localImages`).map(
    (item, index) => {
      const image = recordOf(item, `${label}.background.localImages[${index}]`)
      return {
        id: nonEmptyStringOf(image.id, `${label}.background.localImages[${index}].id`),
        name: stringOf(image.name, `${label}.background.localImages[${index}].name`),
      }
    },
  )
  const bgUrls = arrayOf(background.urls, `${label}.background.urls`).map((item, index) => {
    const url = recordOf(item, `${label}.background.urls[${index}]`)
    return {
      id: nonEmptyStringOf(url.id, `${label}.background.urls[${index}].id`),
      url: stringOf(url.url, `${label}.background.urls[${index}].url`),
    }
  })

  return {
    version: 1,
    bgMode: choiceOf(background.mode, ['color', 'local', 'image'] as const, `${label}.background.mode`),
    bgColors: stringArrayOf(background.colors, `${label}.background.colors`),
    bgLocalImages,
    bgUrls,
    bgRotate: {
      color: booleanOf(rotate.color, `${label}.background.rotate.color`),
      local: booleanOf(rotate.local, `${label}.background.rotate.local`),
      image: booleanOf(rotate.image, `${label}.background.rotate.image`),
    },
    bgInterval: {
      color: numberOf(intervals.color, `${label}.background.intervalSeconds.color`),
      local: numberOf(intervals.local, `${label}.background.intervalSeconds.local`),
      image: numberOf(intervals.image, `${label}.background.intervalSeconds.image`),
    },
    bgPick: {
      color: stringOf(selected.color, `${label}.background.selected.color`),
      local: stringOf(selected.local, `${label}.background.selected.local`),
      image: stringOf(selected.image, `${label}.background.selected.image`),
    },
    bgBlur: numberOf(background.blur, `${label}.background.blur`),
    motion: choiceOf(source.motion, ['system', 'always', 'off'] as const, `${label}.motion`),
    glass: choiceOf(source.glass, ['system', 'always', 'off'] as const, `${label}.glass`),
    themeColor: stringOf(source.themeColor, `${label}.themeColor`),
    scrimOpacity: numberOf(source.scrimOpacity, `${label}.scrimOpacity`),
    drawerSide: choiceOf(source.drawerSide, ['left', 'right'] as const, `${label}.drawerSide`),
    closeOnScrim: booleanOf(source.closeOnScrim, `${label}.closeOnScrim`),
    handleRatio: numberOf(source.handleRatio, `${label}.handleRatio`),
    areaMode: choiceOf(area.mode, ['pixel', 'cell'] as const, `${label}.area.mode`),
    areaWidth: numberOf(area.width, `${label}.area.width`),
    areaHeight: numberOf(area.height, `${label}.area.height`),
    areaCols: numberOf(area.columns, `${label}.area.columns`),
    areaRows: numberOf(area.rows, `${label}.area.rows`),
  }
}

/** Parse and fully validate the portable JSON before any storage is changed. */
export function parseConfigImport(value: unknown): ParsedConfigImport {
  const source = recordOf(value, '根节点')
  if (source.format !== CONFIG_FORMAT) invalid('format 不匹配')
  if (source.version !== CONFIG_EXPORT_VERSION) invalid('version 不被支持')

  const rawProfiles = arrayOf(source.profiles, 'profiles')
  if (rawProfiles.length === 0) invalid('profiles 为空')
  if (rawProfiles.length > IMPORT_MAX_PROFILES) invalid('profiles 数量过多')

  const uuids = new Set<string>()
  const profiles = rawProfiles.map((value, index): ImportedProfile => {
    const label = `profiles[${index}]`
    const profile = recordOf(value, label)
    if (!isUuid(profile.uuid)) invalid(`${label}.uuid 不合法`)
    if (uuids.has(profile.uuid)) invalid(`${label}.uuid 重复`)
    uuids.add(profile.uuid)

    const name = stringOf(profile.name, `${label}.name`)
    if (name.length > PROFILE_NAME_MAX) invalid(`${label}.name 超过 ${PROFILE_NAME_MAX} 个字符`)
    if (!isProfilePreset(profile.preset)) invalid(`${label}.preset 不被支持`)
    return {
      uuid: profile.uuid,
      name,
      preset: profile.preset,
      grid: importedGrid(profile.grid, `${label}.grid`),
      settings: importedSettings(profile.settings, `${label}.settings`),
    }
  })

  if (!isUuid(source.activeProfileUuid) || !uuids.has(source.activeProfileUuid)) {
    invalid('activeProfileUuid 没有指向文件中的配置')
  }
  const global = source.global === null ? null : recordOf(source.global, 'global')

  return {
    activeProfileUuid: source.activeProfileUuid,
    profiles,
    global,
    todos: arrayOf(source.todos, 'todos'),
    searchHistory: arrayOf(source.searchHistory, 'searchHistory'),
  }
}

export function configImportConflicts(config: ParsedConfigImport): ProfileEntry[] {
  const importedUuids = new Set(config.profiles.map((profile) => profile.uuid))
  return listProfiles().filter((profile) => importedUuids.has(profile.uuid))
}

function writeImportedJson(key: string, value: unknown | null): void {
  if (value === null) localStorage.removeItem(key)
  else localStorage.setItem(key, JSON.stringify(value))
}

/** Merge validated profiles by UUID, restore shared data, then select the exported active profile. */
export function applyConfigImport(config: ParsedConfigImport): void {
  const idsByUuid = upsertProfilesByUuid(config.profiles)
  for (const profile of config.profiles) {
    const id = idsByUuid.get(profile.uuid)
    if (!id) throw new Error('无法为导入的配置分配本地标识')
    writeImportedJson(keyForProfile('grid', id), profile.grid)
    writeImportedJson(keyForProfile('settings', id), profile.settings)
  }

  writeImportedJson(globalKey('global'), config.global)
  writeImportedJson(globalKey('todos'), config.todos)
  writeImportedJson(globalKey('search-history'), config.searchHistory)

  const activeId = idsByUuid.get(config.activeProfileUuid)
  if (!activeId) throw new Error('无法找到导入文件的当前配置')
  setActiveProfile(activeId)
}

export function downloadConfigSnapshot(): void {
  const json = JSON.stringify(buildConfigExport(), null, 2)
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `leisure-hub-config-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
