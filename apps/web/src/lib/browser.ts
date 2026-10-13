export function browserSupported(userAgent = navigator.userAgent): boolean {
  const patterns: Array<[RegExp, number]> = [
    [/Edg\/(\d+)/, 109], [/Chrome\/(\d+)/, 109], [/Firefox\/(\d+)/, 115], [/Version\/(\d+).*Safari\//, 16]
  ];
  return patterns.some(([pattern, minimum]) => {
    const version = userAgent.match(pattern)?.[1];
    return version ? Number(version) >= minimum : false;
  });
}

