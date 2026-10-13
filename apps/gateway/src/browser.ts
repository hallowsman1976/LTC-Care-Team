export function isSupportedBrowser(userAgent: string): boolean {
  const checks: Array<[RegExp, number]> = [
    [/Edg\/(\d+)/, 109],
    [/Chrome\/(\d+)/, 109],
    [/Firefox\/(\d+)/, 115],
    [/Version\/(\d+).*Safari\//, 16]
  ];
  for (const [pattern, minimum] of checks) {
    const match = userAgent.match(pattern);
    if (match?.[1]) return Number(match[1]) >= minimum;
  }
  return false;
}

