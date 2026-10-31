export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<string | number>;
}

const SEMVER_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseSemver(value: string | null | undefined): ParsedSemver | null {
  const match = typeof value === "string" ? SEMVER_PATTERN.exec(value.trim()) : null;
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]
      ? match[4].split(".").map((identifier) => (/^\d+$/.test(identifier) ? Number(identifier) : identifier))
      : [],
  };
}

export function isPrerelease(value: string): boolean {
  return (parseSemver(value)?.prerelease.length ?? 0) > 0;
}

/**
 * Compares versions by SemVer 2.0 precedence. Build metadata is ignored.
 * Returns null when either value is not a valid version.
 */
export function compareSemver(left: string, right: string): number | null {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return null;

  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }

  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0;
    return a.prerelease.length === 0 ? 1 : -1;
  }

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index++) {
    const leftId = a.prerelease[index];
    const rightId = b.prerelease[index];
    if (leftId === undefined) return -1;
    if (rightId === undefined) return 1;
    if (leftId === rightId) continue;
    if (typeof leftId === "number" && typeof rightId === "number") return leftId < rightId ? -1 : 1;
    if (typeof leftId === "number") return -1;
    if (typeof rightId === "number") return 1;
    return leftId < rightId ? -1 : 1;
  }
  return 0;
}
