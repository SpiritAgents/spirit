const MASTER_SIZE = 512;
const OPTICAL_RATIO_EXPONENT = 0.65;

function formatNumber(value) {
  return Number(value.toFixed(4)).toString();
}

function setAttributes(tag, attributes) {
  let output = tag;
  for (const [name, value] of Object.entries(attributes)) {
    const pattern = new RegExp(`\\s${name}="[^"]*"`);
    if (!pattern.test(output)) {
      throw new Error(`Missing ${name} on optical logo element: ${tag}`);
    }
    output = output.replace(pattern, ` ${name}="${formatNumber(value)}"`);
  }
  return output;
}

/**
 * Preserve the 512px master and compensate strokes, glow, and opacity for smaller raster targets.
 * The same source transformation powers packaging icons and size-specific SVG previews.
 */
export function createOpticalLogoSvg(sourceSvg, size) {
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(`Logo size must be a positive finite number: ${size}`);
  }

  const ratio = size >= MASTER_SIZE ? 1 : (MASTER_SIZE / size) ** OPTICAL_RATIO_EXPONENT;
  const boost = Math.max(0, Math.min(1, (256 - size) / 256));
  const variant = sourceSvg.includes('id="logo-dark-')
    ? "dark"
    : sourceSvg.includes('id="logo-light-')
      ? "light"
      : null;
  if (!variant) {
    throw new Error("Expected a Spirit dark or light logo SVG source");
  }

  const opacity =
    variant === "dark"
      ? { crisp: 0.85 + 0.08 * boost, soft: 0.3 + 0.05 * boost }
      : { crisp: 0.72 + 0.1 * boost, soft: 0.18 + 0.04 * boost };

  let output = sourceSvg.replace(
    /<(?:path|feGaussianBlur)\b[^>]*data-optical="([^"]+)"[^>]*>/g,
    (tag, role) => {
      switch (role) {
        case "fresnel-stroke":
          return setAttributes(tag, { "stroke-width": 3 * ratio, opacity: 0.25 + 0.05 * boost });
        case "crisp-stroke":
          return setAttributes(tag, {
            "stroke-width": 0.75 * ratio,
            "stroke-opacity": opacity.crisp,
          });
        case "soft-stroke":
          return setAttributes(tag, {
            "stroke-width": 1.5 * ratio,
            "stroke-opacity": opacity.soft,
            opacity: 0.5 + 0.08 * boost,
          });
        case "blur-sm":
          return setAttributes(tag, { stdDeviation: 1.5 * ratio });
        case "blur-md":
          return setAttributes(tag, { stdDeviation: 4 * ratio });
        default:
          throw new Error(`Unknown optical logo role: ${role}`);
      }
    },
  );

  output = output.replace(/(<svg\b[^>]*\bwidth=")[^"]*(")/, `$1${formatNumber(size)}$2`);
  output = output.replace(/(<svg\b[^>]*\bheight=")[^"]*(")/, `$1${formatNumber(size)}$2`);
  return output;
}
