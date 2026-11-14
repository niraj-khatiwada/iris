export function usePlatform() {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent

  return {
    isMacOS: /Mac/i.test(userAgent),
    isWindows: /Win/i.test(userAgent),
    isLinux: /Linux/i.test(userAgent),
  }
}
