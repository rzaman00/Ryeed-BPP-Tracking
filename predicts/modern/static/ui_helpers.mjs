export function deriveCityLabel(feature, idx = 0) {
  const p = feature?.properties || {};
  let city = String(p.city || p.municipality || p.CITY || '').trim();
  if (!city) {
    const parts = String(p.address || '').split(',').map(x => x.trim()).filter(Boolean);
    if (parts.length >= 3) city = parts[parts.length - 2];
    else if (parts.length >= 2) city = parts[1];
  }
  if (city) return city;
  const fallback = String(p.name || '').trim();
  return fallback || `Launch ${idx + 1}`;
}

export function formatSweepParameter(parameter, value) {
  const n = Number(value);
  const shown = Number.isFinite(n) ? n.toLocaleString(undefined, {maximumFractionDigits: 3}) : String(value ?? '—');
  if (parameter === 'ascent_rate_ms') return `Ascent rate: ${shown} m/s`;
  if (parameter === 'descent_rate_ms') return `Descent rate: ${shown} m/s`;
  if (parameter === 'altitude') return `Burst/Float altitude: ${shown} m`;
  return `Sweep value: ${shown}`;
}
