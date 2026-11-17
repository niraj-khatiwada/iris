import type { ChatAttachment, DocumentPurpose } from '@/types/chat'

export const MAX_IMAGES = 4
export const MAX_DOCUMENTS = 20
export const USER_DATA_MAX_BYTES = 32 * 1024 * 1024
export const PARSED_DOCUMENT_MAX_BYTES = 100 * 1024 * 1024

/** PDF, Word, and PowerPoint files are parsed with their figures kept. */
const LAYOUT_EXTS = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx'])
/** Text, code, spreadsheets, and ebooks are uploaded as user data without parsing. */
const USER_DATA_EXTS = new Set([
  'txt',
  'text',
  'md',
  'markdown',
  'mdx',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'ndjson',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'env',
  'log',
  'rst',
  'tex',
  'html',
  'htm',
  'xhtml',
  'css',
  'scss',
  'sass',
  'less',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'kts',
  'swift',
  'c',
  'h',
  'cc',
  'cpp',
  'cxx',
  'hpp',
  'cs',
  'php',
  'pl',
  'lua',
  'r',
  'sql',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'bat',
  'cmd',
  'vue',
  'svelte',
  'astro',
  'graphql',
  'gql',
  'proto',
  'xls',
  'xlsx',
  'epub',
  'mobi',
])

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  text: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/typescript',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  epub: 'application/epub+zip',
  mobi: 'application/x-mobipocket-ebook',
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** Returns the Files API purpose for a document, or null for an unsupported file. */
export function documentPurposeFor(file: File): DocumentPurpose | null {
  const ext = fileExtension(file.name)
  if (LAYOUT_EXTS.has(ext)) {
    return 'rich_layout_recognition'
  }
  if (USER_DATA_EXTS.has(ext)) {
    return 'user_data'
  }
  return null
}

export function documentSizeLimit(purpose: DocumentPurpose): number {
  return purpose === 'user_data'
    ? USER_DATA_MAX_BYTES
    : PARSED_DOCUMENT_MAX_BYTES
}

export function documentMimeType(file: File): string {
  return (
    file.type ||
    MIME_BY_EXT[fileExtension(file.name)] ||
    'application/octet-stream'
  )
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/** Documents are identified by their Files API id; images keep inline data. */
export function isDocumentAttachment(attachment: ChatAttachment): boolean {
  return Boolean(attachment.fileId) || attachment.kind === 'document'
}

export function isImageAttachment(attachment: ChatAttachment): boolean {
  return !isDocumentAttachment(attachment) && Boolean(attachment.dataUrl)
}
