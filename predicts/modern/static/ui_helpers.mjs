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

export const DEFAULT_SAFETY_RULES = Object.freeze({
  gustLowMaxMph: 5,
  gustNoGoAboveMph: 15,
  precipitationCautionAboveIn: 0,
  precipitationNoGoAboveIn: 0.1,
  forecastCautionAfterMin: 60,
  forecastNoGoAfterMin: 180,
  minAirspaceVerticalClearanceFt: 2000,
  maxAirspaceOverflightMin: 10,
  maxAirspaceCrossingM: 0,
  minLandingAirspaceDistanceMi: 5,
  maxWaterCrossingM: 0,
  minLandingWaterDistanceMi: 5,
  highRiskLandingNoGo: true,
});

function factor(status, detail) {
  return {status, detail};
}

function finiteNumber(value) {
  return value === null || value === undefined || value === '' ? NaN : Number(value);
}

export function normalizeSafetyRules(candidate = {}) {
  const numeric = (key, minimum = 0) => {
    const value = finiteNumber(candidate?.[key]);
    return Number.isFinite(value) ? Math.max(minimum, value) : DEFAULT_SAFETY_RULES[key];
  };
  const gustLowMaxMph = numeric('gustLowMaxMph');
  const precipitationCautionAboveIn = numeric('precipitationCautionAboveIn');
  const forecastCautionAfterMin = numeric('forecastCautionAfterMin');
  return {
    gustLowMaxMph,
    gustNoGoAboveMph: Math.max(gustLowMaxMph, numeric('gustNoGoAboveMph')),
    precipitationCautionAboveIn,
    precipitationNoGoAboveIn: Math.max(precipitationCautionAboveIn, numeric('precipitationNoGoAboveIn')),
    forecastCautionAfterMin,
    forecastNoGoAfterMin: Math.max(forecastCautionAfterMin, numeric('forecastNoGoAfterMin')),
    minAirspaceVerticalClearanceFt: numeric('minAirspaceVerticalClearanceFt'),
    maxAirspaceOverflightMin: numeric('maxAirspaceOverflightMin'),
    maxAirspaceCrossingM: 0,
    minLandingAirspaceDistanceMi: numeric('minLandingAirspaceDistanceMi'),
    maxWaterCrossingM: numeric('maxWaterCrossingM'),
    minLandingWaterDistanceMi: numeric('minLandingWaterDistanceMi'),
    highRiskLandingNoGo: candidate?.highRiskLandingNoGo !== false,
  };
}

export function evaluateReadiness(weather, optimal, forecastAgeMinutes, safetyRules = DEFAULT_SAFETY_RULES) {
  const rules = normalizeSafetyRules(safetyRules);
  const gust = finiteNumber(weather?.wind_gust_mph);
  const precipitation = finiteNumber(weather?.precipitation_in ?? weather?.rain_in ?? 0);
  const intrusion = finiteNumber(optimal?.airspace_3d_intrusion_m ?? optimal?.airspace_intrusion_m);
  const horizontalCrossing = finiteNumber(optimal?.airspace_horizontal_intrusion_m ?? intrusion);
  const clearanceViolation = finiteNumber(optimal?.airspace_clearance_violation_m ?? intrusion);
  const overflightSeconds = finiteNumber(optimal?.airspace_overflight_s ?? (horizontalCrossing > 0 ? Infinity : 0));
  const verticalClearance = finiteNumber(optimal?.airspace_min_vertical_clearance_m);
  const waterCrossing = finiteNumber(optimal?.water_crossing_m);
  const landingAirspaceDistance = finiteNumber(optimal?.landing_airspace_distance_m);
  const landingWaterDistance = finiteNumber(optimal?.landing_large_water_distance_m);
  const age = finiteNumber(forecastAgeMinutes);
  const conflictLayers = Array.isArray(optimal?.conflict_layers) ? optimal.conflict_layers : [];

  const factors = {
    gusts: !Number.isFinite(gust)
      ? factor('no-go', 'Gust forecast unavailable')
      : gust > rules.gustNoGoAboveMph
        ? factor('no-go', `${gust.toFixed(1)} mph · high`)
        : gust > rules.gustLowMaxMph
          ? factor('caution', `${gust.toFixed(1)} mph · medium`)
          : factor('go', `${gust.toFixed(1)} mph · low`),
    precipitation: !weather
      ? factor('no-go', 'Precipitation forecast unavailable')
      : precipitation > rules.precipitationNoGoAboveIn
        ? factor('no-go', `${Math.max(0, precipitation).toFixed(2)} in · above limit`)
        : (weather.rain === true || String(weather.rain) === 'true' || precipitation > rules.precipitationCautionAboveIn)
        ? factor('caution', `${Math.max(0, precipitation).toFixed(2)} in · precipitation present`)
        : factor('go', 'Dry'),
    airspace: !optimal || !Number.isFinite(intrusion) || !Number.isFinite(horizontalCrossing) || !Number.isFinite(clearanceViolation)
      ? factor('no-go', 'Airspace analysis unavailable')
      : intrusion > rules.maxAirspaceCrossingM
        ? factor('no-go', `${intrusion.toFixed(0)} m 3-D intrusion · ${conflictLayers.join(', ') || 'operational airspace'}`)
        : clearanceViolation > 0
          ? factor('no-go', `Overflight below ${rules.minAirspaceVerticalClearanceFt.toFixed(0)} ft clearance`)
          : horizontalCrossing > 0 && !Number.isFinite(overflightSeconds)
            ? factor('no-go', 'Airspace overflight duration unavailable')
            : overflightSeconds > rules.maxAirspaceOverflightMin * 60
              ? factor('no-go', `${(overflightSeconds / 60).toFixed(1)} min overflight · ${rules.maxAirspaceOverflightMin.toFixed(0)} min limit`)
              : horizontalCrossing > 0
                ? factor('go', `${(overflightSeconds / 60).toFixed(1)} min high overflight${Number.isFinite(verticalClearance) ? ` · ${(verticalClearance * 3.28084).toFixed(0)} ft clear` : ''}`)
                : factor('go', 'No B/C/D, SUA, or TFR crossing'),
    freshness: !Number.isFinite(age)
      ? factor('no-go', 'Forecast freshness unavailable')
      : age > rules.forecastNoGoAfterMin
        ? factor('no-go', `${Math.round(age)} min old`)
        : age > rules.forecastCautionAfterMin
          ? factor('caution', `${Math.round(age)} min old`)
          : factor('go', age < 1 ? 'Updated less than 1 min ago' : `Updated ${Math.round(age)} min ago`),
    landing: !optimal || !Number.isFinite(waterCrossing) || !Number.isFinite(landingAirspaceDistance) || !Number.isFinite(landingWaterDistance)
      ? factor('no-go', 'Landing-risk analysis unavailable')
      : optimal.landing_in_water
        ? factor('no-go', 'Predicted landing is in mapped water')
        : waterCrossing > rules.maxWaterCrossingM
          ? factor('no-go', `${waterCrossing.toFixed(0)} m large-water crossing`)
          : (optimal.landing_in_operational_airspace || optimal.landing_in_high_risk_airspace) && rules.highRiskLandingNoGo
            ? factor('no-go', 'Landing inside B/C/D, SUA, or TFR airspace')
            : Number.isFinite(landingAirspaceDistance) && landingAirspaceDistance < rules.minLandingAirspaceDistanceMi * 1609.344
              ? factor('no-go', `Landing only ${(landingAirspaceDistance / 1609.344).toFixed(1)} mi from airspace`)
              : Number.isFinite(landingWaterDistance) && landingWaterDistance < rules.minLandingWaterDistanceMi * 1609.344
                ? factor('no-go', `Landing only ${(landingWaterDistance / 1609.344).toFixed(1)} mi from large water`)
                : factor('go', `Landing ≥${rules.minLandingAirspaceDistanceMi.toFixed(0)} mi from airspace and ≥${rules.minLandingWaterDistanceMi.toFixed(0)} mi from large water`),
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
