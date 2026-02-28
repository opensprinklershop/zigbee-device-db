'use strict';

/**
 * Zigbee Device Database Generator
 * ---------------------------------
 * Pulls device definitions from zigbee-herdsman-converters and generates
 * a structured JSON database for OpenSprinkler firmware and UI.
 *
 * Output: ../dist/devices.json
 *   {
 *     _meta: { generated, source, version, count },
 *     by_fingerprint: {          // primary index: "manufacturerName|modelID"
 *       "_TZE284_nhgdf6qr|TS0601": { vendor, model, description, sensors[], is_tuya }
 *     },
 *     by_model: {                // fallback index: zigbeeModel string
 *       "TS0601": [...]
 *     }
 *   }
 *
 * Usage:
 *   npm install
 *   node fetch_devices.js
 */

const fs   = require('fs');
const path = require('path');

// ─── load converter package ────────────────────────────────────────────────

let definitions;
let pkgVersion = 'unknown';

try {
  definitions = require('zigbee-herdsman-converters').definitions;
  pkgVersion  = require('zigbee-herdsman-converters/package.json').version;
} catch (e) {
  console.error('[ERROR] zigbee-herdsman-converters not found.');
  console.error('        Run: npm install');
  process.exit(1);
}

// ─── ZCL cluster → OpenSprinkler sensor descriptor ─────────────────────────
//   unitid matches the enum in OpenSprinkler firmware (defines.h: UNIT_*)

const ZCL_MAP = {
  temperature:     { cluster_id: '0x0402', attr_id: '0x0000', unit: '°C',  unitid: 2,  factor: 1, divider: 100 },
  humidity:        { cluster_id: '0x0405', attr_id: '0x0000', unit: '%',   unitid: 5,  factor: 1, divider: 100 },
  illuminance:     { cluster_id: '0x0400', attr_id: '0x0000', unit: 'lux', unitid: 13, factor: 1, divider: 1   },
  soil_moisture:   { cluster_id: '0x0408', attr_id: '0x0000', unit: '%',   unitid: 1,  factor: 1, divider: 10  },
  co2:             { cluster_id: '0x040D', attr_id: '0x0000', unit: 'ppm', unitid: 14, factor: 1, divider: 1   },
  pressure:        { cluster_id: '0x0403', attr_id: '0x0000', unit: 'hPa', unitid: 20, factor: 1, divider: 10  },
  battery_voltage: { cluster_id: '0x0001', attr_id: '0x0020', unit: 'V',   unitid: 17, factor: 1, divider: 1000},
  battery:         { cluster_id: '0x0001', attr_id: '0x0021', unit: '%',   unitid: 5,  factor: 1, divider: 2   },
  pm25:            { cluster_id: '0x042A', attr_id: '0x0000', unit: 'µg/m³', unitid: 0, factor: 1, divider: 1  },
  voc:             { cluster_id: '0x042E', attr_id: '0x0000', unit: 'ppb', unitid: 0,  factor: 1, divider: 1   },
};

// Tuya DP feature names → ZCL-equivalent unit info (for display only)
const TUYA_UNIT_MAP = {
  temperature:   { unit: '°C',  unitid: 2  },
  humidity:      { unit: '%',   unitid: 5  },
  soil_moisture: { unit: '%',   unitid: 1  },
  battery:       { unit: '%',   unitid: 5  },
  illuminance:   { unit: 'lux', unitid: 13 },
  co2:           { unit: 'ppm', unitid: 14 },
  pressure:      { unit: 'hPa', unitid: 20 },
};

// Features to skip (not sensors, are actuators or config)
const SKIP_FEATURES = new Set([
  'action', 'state', 'mode', 'preset', 'child_lock', 'setup',
  'linkquality', 'update', 'identify', 'selftest', 'factory_reset',
  'brightness', 'color_temp', 'color', 'effect',
]);

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Try to determine scale (factor / divider) from a Tuya value-converter.
 * Converters are objects or functions – we inspect their .name property.
 */
function converterScale(converter) {
  if (!converter) return { factor: 1, divider: 1 };

  // The converter may be { from, to } pair; use "from" (device→app direction)
  const fn   = typeof converter === 'function' ? converter
             : (converter.from || converter.to || null);
  const name = (typeof fn === 'function' ? fn.name : '')
             || (typeof converter === 'object' ? (converter.name || '') : '')
             || '';

  if (/divideBy10\b/i.test(name))  return { factor: 1, divider: 10 };
  if (/divideBy100\b/i.test(name)) return { factor: 1, divider: 100 };
  if (/multiply10\b/i.test(name))  return { factor: 10, divider: 1 };
  if (/multiply100\b/i.test(name)) return { factor: 100, divider: 1 };
  return { factor: 1, divider: 1 };
}

/**
 * Recursively walk Z2M `exposes` and map numeric features to ZCL sensor
 * descriptors. Non-mapped features are included with unit info only.
 */
function sensorsFromExposes(exposes, depth = 0) {
  const sensors = [];
  if (!Array.isArray(exposes) || depth > 3) return sensors;

  for (const exp of exposes) {
    if (!exp) continue;

    // Composite / group: recurse
    if (Array.isArray(exp.features)) {
      sensors.push(...sensorsFromExposes(exp.features, depth + 1));
      continue;
    }
    if (exp.type !== 'numeric') continue;

    const name = exp.property || exp.name || '';
    if (!name || SKIP_FEATURES.has(name)) continue;

    const zcl = ZCL_MAP[name];
    if (zcl) {
      sensors.push({
        name,
        description: exp.description || name.replace(/_/g, ' '),
        unit:       exp.unit || zcl.unit,
        unitid:     zcl.unitid,
        cluster_id: zcl.cluster_id,
        attr_id:    zcl.attr_id,
        endpoint:   1,
        factor:     zcl.factor,
        divider:    zcl.divider,
        is_tuya_dp: false,
      });
    } else if (exp.unit) {
      // Keep unknown numeric features with units (might be useful)
      sensors.push({
        name,
        description: exp.description || name.replace(/_/g, ' '),
        unit:    exp.unit,
        unitid:  0,
        is_tuya_dp: false,
      });
    }
  }
  return sensors;
}

/**
 * Extract sensors from Tuya `meta.tuyaDatapoints`.
 * Format: [ [dp_number, feature_name, converter], ... ]
 */
function sensorsFromTuyaDPs(tuyaDatapoints) {
  if (!Array.isArray(tuyaDatapoints)) return [];
  const sensors = [];

  for (const row of tuyaDatapoints) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const [dpNum, dpName, converter] = row;

    if (typeof dpNum !== 'number') continue;
    if (typeof dpName !== 'string' || !dpName || SKIP_FEATURES.has(dpName)) continue;

    const scale      = converterScale(converter);
    const unitInfo   = TUYA_UNIT_MAP[dpName] || { unit: '', unitid: 0 };

    sensors.push({
      name:        dpName,
      description: dpName.replace(/_/g, ' '),
      unit:        unitInfo.unit,
      unitid:      unitInfo.unitid,
      cluster_id:  '0xEF00',           // Tuya private cluster
      attr_id:     `0x${dpNum.toString(16).padStart(4, '0')}`,
      endpoint:    1,
      dp:          dpNum,
      factor:      scale.factor,
      divider:     scale.divider,
      is_tuya_dp:  true,
    });
  }
  return sensors;
}

// ─── build database ─────────────────────────────────────────────────────────

const db = {
  _meta: {
    generated:  new Date().toISOString(),
    source:     'zigbee-herdsman-converters',
    version:    pkgVersion,
    count:      { total: 0, fingerprints: 0, models: 0 },
  },
  by_fingerprint: {},
  by_model:       {},
};

let totalDefs = 0, fpCount = 0;

for (const def of definitions) {
  if (!def) continue;
  totalDefs++;

  const isTuya   = !!(def.meta && Array.isArray(def.meta.tuyaDatapoints));
  const sensors  = isTuya
    ? sensorsFromTuyaDPs(def.meta.tuyaDatapoints)
    : sensorsFromExposes(def.exposes);

  const entry = {
    vendor:      def.vendor      || '',
    model:       def.model       || '',
    description: def.description || '',
    sensors,
    is_tuya:     isTuya,
    endpoint:    1,
  };

  // ── by_fingerprint: keyed as "manufacturerName|modelID" ─────────────────
  const fingerprints = def.fingerprint || [];
  for (const fp of fingerprints) {
    if (!fp || !fp.manufacturerName) continue;
    const key = `${fp.manufacturerName}|${fp.modelID || def.model}`;
    db.by_fingerprint[key] = entry;
    fpCount++;
  }

  // ── by_model: keyed by zigbeeModel string ────────────────────────────────
  const zigbeeModels = def.zigbeeModel || (def.model ? [def.model] : []);
  for (const m of zigbeeModels) {
    if (!m) continue;
    if (!db.by_model[m]) db.by_model[m] = [];
    // Avoid exact duplicates (same vendor+model)
    const dup = db.by_model[m].some(e => e.vendor === entry.vendor && e.model === entry.model);
    if (!dup) db.by_model[m].push(entry);
  }
}

db._meta.count.total        = totalDefs;
db._meta.count.fingerprints = fpCount;
db._meta.count.models       = Object.keys(db.by_model).length;

// ─── write output ────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, '..', 'dist');
fs.mkdirSync(outDir, { recursive: true });

// Full database (pretty-printed for readability in git)
fs.writeFileSync(
  path.join(outDir, 'devices.json'),
  JSON.stringify(db, null, 2),
);

// Compact fingerprint-only lookup (minified, lighter for HTTP serving)
const compact = {
  _meta:           db._meta,
  by_fingerprint:  db.by_fingerprint,
};
fs.writeFileSync(
  path.join(outDir, 'devices_compact.json'),
  JSON.stringify(compact),
);

// Index file: fingerprint keys only (for fast "is this device known?" check)
fs.writeFileSync(
  path.join(outDir, 'fingerprint_index.json'),
  JSON.stringify(Object.keys(db.by_fingerprint)),
);

console.log('─── Zigbee device DB generated ─────────────────────────');
console.log(`  Source:       zigbee-herdsman-converters v${pkgVersion}`);
console.log(`  Definitions:  ${totalDefs}`);
console.log(`  Fingerprints: ${fpCount}  (→ dist/devices.json:by_fingerprint)`);
console.log(`  Models:       ${db._meta.count.models}  (→ dist/devices.json:by_model)`);
console.log(`  Output dir:   ${outDir}/`);
console.log('');
