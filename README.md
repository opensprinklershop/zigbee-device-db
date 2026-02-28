# Zigbee Device Database

Auto-generated Zigbee device database sourced from [`zigbee-herdsman-converters`](https://github.com/Koenkk/zigbee-herdsman-converters) (the library powering Zigbee2MQTT).

Used by [OpenSprinkler](https://opensprinkler.com) firmware and UI to display rich device info after
Zigbee device discovery.

## Database contents

| File | Description | Size |
|------|-------------|------|
| `dist/devices.json` | Full database: fingerprint index + model index + sensors | ~5 MB |
| `dist/devices_compact.json` | Fingerprint index only (minified) | ~1.4 MB |
| `dist/fingerprint_index.json` | List of all known fingerprint keys | ~34 KB |

**As of the latest run:** 3 421 device definitions, 1 360 fingerprint entries, 4 210 model entries.

## API

Served live at `https://opensprinklershop.de/zigbee/devices_api.php`:

```
GET /zigbee/devices_api.php?manufacturer=_TZE284_nhgdf6qr&model=TS0601
→ { vendor, model, description, sensors[], is_tuya }

GET /zigbee/devices_api.php?model=TS0601
→ { count, candidates[] }

GET /zigbee/devices_api.php?search=soil
→ { results[], count }

GET /zigbee/devices_api.php?list=1&page=1&per_page=50
→ { total, items[] }

GET /zigbee/devices_api.php?meta=1
→ { generated, source, version, count }
```

## Sensor descriptor format

Each entry in `sensors[]` has:

```json
{
  "name":        "soil_moisture",
  "description": "soil moisture",
  "unit":        "%",
  "unitid":      1,
  "cluster_id":  "0xEF00",
  "attr_id":     "0x0003",
  "endpoint":    1,
  "dp":          3,
  "factor":      1,
  "divider":     1,
  "is_tuya_dp":  true
}
```

- **Tuya devices** (`is_tuya_dp: true`): use `cluster_id: 0xEF00` (Tuya private), `dp` = Tuya data point number
- **Standard ZCL devices** (`is_tuya_dp: false`): use standard cluster/attribute IDs

## IEEE address index

Zigbee2MQTT does **not** track per-device IEEE addresses — those are coordinator-specific.
The IEEE → device mapping is maintained client-side:

1. Coordinator discovers device → reports `{ ieee, manufacturer, model }` via `/zg` API
2. UI calls `devices_api.php?manufacturer=X&model=Y` → gets device info
3. UI caches result by IEEE in `localStorage`: `zb_dev_{ieee} = { ...deviceInfo }`

## Auto-update

GitHub Actions runs every Monday 04:00 UTC. If a new `zigbee-herdsman-converters` version is
available, the `dist/` files are regenerated and committed automatically.

To deploy manually on the OpenSprinkler server:

```bash
cd /srv/www/htdocs/zigbee/device-db/scripts
./update_zigbee_db.sh
```

## Local development

```bash
cd scripts/
npm install
node fetch_devices.js
# → dist/devices.json
```

## Repository

Part of the [opensprinklershop](https://github.com/opensprinklershop) organisation.
Source: [`opensprinklershop/zigbee-device-db`](https://github.com/opensprinklershop/zigbee-device-db)
