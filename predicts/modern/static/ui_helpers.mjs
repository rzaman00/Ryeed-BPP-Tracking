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

const READINESS_SEVERITY = {go: 0, caution: 1, 'no-go': 2};

function factor(status, detail) {
  return {status, detail};
}

function finiteNumber(value) {
  return value === null || value === undefined || value === '' ? NaN : Number(value);
}

export function evaluateReadiness(weather, optimal, forecastAgeMinutes) {
  const gust = finiteNumber(weather?.wind_gust_mph);
  const precipitation = finiteNumber(weather?.precipitation_in ?? weather?.rain_in ?? 0);
  const intrusion = finiteNumber(optimal?.airspace_horizontal_intrusion_m ?? optimal?.airspace_intrusion_m);
  const waterCrossing = finiteNumber(optimal?.water_crossing_m);
  const age = finiteNumber(forecastAgeMinutes);
  const conflictLayers = Array.isArray(optimal?.conflict_layers) ? optimal.conflict_layers : [];

  const factors = {
    gusts: !Number.isFinite(gust)
      ? factor('no-go', 'Gust forecast unavailable')
      : gust > 15
        ? factor('no-go', `${gust.toFixed(1)} mph · high`)
        : gust > 5
          ? factor('caution', `${gust.toFixed(1)} mph · medium`)
          : factor('go', `${gust.toFixed(1)} mph · low`),
    precipitation: !weather
      ? factor('no-go', 'Precipitation forecast unavailable')
      : (weather.rain === true || String(weather.rain) === 'true' || precipitation > 0)
        ? factor('caution', `${Math.max(0, precipitation).toFixed(2)} in · precipitation present`)
        : factor('go', 'Dry'),
    airspace: !optimal || !Number.isFinite(intrusion)
      ? factor('no-go', 'Airspace analysis unavailable')
      : intrusion > 0
        ? factor('no-go', `${intrusion.toFixed(0)} m crossing · ${conflictLayers.join(', ') || 'controlled airspace'}`)
        : factor('go', 'No B/C/D, SUA, or TFR crossing'),
    freshness: !Number.isFinite(age)
      ? factor('no-go', 'Forecast freshness unavailable')
      : age > 180
        ? factor('no-go', `${Math.round(age)} min old`)
        : age > 60
          ? factor('caution', `${Math.round(age)} min old`)
          : factor('go', age < 1 ? 'Updated less than 1 min ago' : `Updated ${Math.round(age)} min ago`),
    landing: !optimal || !Number.isFinite(waterCrossing)
      ? factor('no-go', 'Landing-risk analysis unavailable')
      : optimal.landing_in_water
        ? factor('no-go', 'Predicted landing is in mapped water')
        : waterCrossing > 0
          ? factor('no-go', `${waterCrossing.toFixed(0)} m Chesapeake Bay crossing`)
          : optimal.landing_in_high_risk_airspace
        ? factor('no-go', 'Landing inside restricted/SUA/TFR airspace')
        : factor('go', 'No water crossing; landing outside high-risk airspace'),
  };
  const values = Object.values(factors);
  const severity = Math.max(...values.map(item => READINESS_SEVERITY[item.status]));
  const status = severity === 2 ? 'no-go' : severity === 1 ? 'caution' : 'go';
  return {
    status,
    factors,
    noGoCount: values.filter(item => item.status === 'no-go').length,
    cautionCount: values.filter(item => item.status === 'caution').length,
  };
}

export function sortReadinessRows(rows, mode = 'safest') {
  const copy = [...rows];
  const finiteOrInfinity = value => {
    const number = finiteNumber(value);
    return Number.isFinite(number) ? number : Infinity;
  };
  copy.sort((a, b) => {
    if (mode === 'gusts') {
      return finiteOrInfinity(a.weather?.wind_gust_mph) - finiteOrInfinity(b.weather?.wind_gust_mph)
        || String(a.site_name).localeCompare(String(b.site_name));
    }
    if (mode === 'flight') {
      return finiteOrInfinity(a.flight_duration_s) - finiteOrInfinity(b.flight_duration_s)
        || String(a.site_name).localeCompare(String(b.site_name));
    }
    const ar = a.readiness || {status: 'no-go', noGoCount: 5, cautionCount: 0};
    const br = b.readiness || {status: 'no-go', noGoCount: 5, cautionCount: 0};
    return READINESS_SEVERITY[ar.status] - READINESS_SEVERITY[br.status]
      || ar.noGoCount - br.noGoCount
      || ar.cautionCount - br.cautionCount
      || finiteOrInfinity(a.optimal?.airspace_horizontal_intrusion_m ?? a.optimal?.airspace_intrusion_m) - finiteOrInfinity(b.optimal?.airspace_horizontal_intrusion_m ?? b.optimal?.airspace_intrusion_m)
      || finiteOrInfinity(a.optimal?.water_crossing_m) - finiteOrInfinity(b.optimal?.water_crossing_m)
      || finiteOrInfinity(a.weather?.wind_gust_mph) - finiteOrInfinity(b.weather?.wind_gust_mph)
      || String(a.site_name).localeCompare(String(b.site_name));
  });
  return copy;
}
