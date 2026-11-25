function addressFamily(address: string): 4 | 6 | 0 {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return 4;
  return address.includes(":") ? 6 : 0;
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b, c, d] = parts as [number, number, number, number];
  if (parts.some((part) => part < 0 || part > 255)) return false;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 255 && b === 255 && c === 255 && d === 255)
  );
}

function expandIpv6(address: string): number[] | null {
  if (address.includes("%")) return null;
  let normalized = address.toLowerCase();
  const ipv4Tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (ipv4Tail) {
    const bytes = ipv4Tail[1]!.split(".").map(Number);
    if (bytes.some((part) => part < 0 || part > 255)) return null;
    const high = ((bytes[0]! << 8) | bytes[1]!).toString(16);
    const low = ((bytes[2]! << 8) | bytes[3]!).toString(16);
    normalized = `${normalized.slice(0, ipv4Tail.index)}${high}:${low}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && head.length + tail.length >= 8) return null;
  const values = [
    ...head,
    ...Array.from({ length: 8 - head.length - tail.length }, () => "0"),
    ...tail,
  ];
  if (values.length !== 8 || values.some((value) => !/^[\da-f]{1,4}$/.test(value))) {
    return null;
  }
  return values.map((value) => Number.parseInt(value, 16));
}

export function isPublicLinkPreviewAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "");
  const family = addressFamily(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family !== 6) return false;
  const groups = expandIpv6(normalized);
  if (!groups) return false;

  const ipv4Mapped = groups.slice(0, 5).every((group) => group === 0);
  if (ipv4Mapped && (groups[5] === 0 || groups[5] === 0xffff)) {
    const ipv4 = [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff].join(".");
    return isPublicIpv4(ipv4);
  }

  const first = groups[0]!;
  if (first < 0x2000 || first >= 0x4000) return false;
  if (first === 0x2002) return false;
  if (first === 0x2001 && (groups[1] === 0 || groups[1] === 0xdb8)) return false;
  return true;
}

export function isLoopbackLinkPreviewHostname(hostname: string): boolean {
  const normalized = hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  const family = addressFamily(normalized);
  if (family === 4) {
    const parts = normalized.split(".").map(Number);
    return parts[0] === 127 && parts.every((part) => part >= 0 && part <= 255);
  }
  if (family !== 6) return false;
  const groups = expandIpv6(normalized);
  if (!groups) return false;
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true;
  if (groups.slice(0, 5).every((group) => group === 0)) {
    if (groups[5] === 0 || groups[5] === 0xffff) return groups[6]! >> 8 === 127;
  }
  return false;
}

export function isPublicLinkPreviewHostname(hostname: string): boolean {
  const normalized = hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (!normalized) return false;
  if (addressFamily(normalized)) return isPublicLinkPreviewAddress(normalized);
  return !(
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "local" ||
    normalized.endsWith(".local") ||
    normalized === "internal" ||
    normalized.endsWith(".internal") ||
    normalized === "home.arpa" ||
    normalized.endsWith(".home.arpa")
  );
}
