# homebridge-dsc-neohub

Homebridge plugin for DSC PowerSeries Neo panels, via a local [NeoHub](https://github.com/BrianHumlicek/NeoHub) server talking ITv2 to a TL280(E) communicator. Fully local; no Alarm.com.

- Each partition → **Security System** (Home / Away / Night / Off, alarm triggered).
- Each zone → **sensor** (contact, motion, smoke, leak, CO, or hidden). Bypassed zones show as inactive.
- If NeoHub or the panel is unreachable, accessories show **No Response** rather than stale state.

## Install

Not on npm yet; install from GitHub into your Homebridge storage directory (builds on install):

```bash
cd /var/lib/homebridge
sudo -u homebridge env PATH=/opt/homebridge/bin:$PATH npm install --save github:splusq/homebridge-dsc-neohub#v0.1.0
```

Then add the platform below and restart Homebridge.

## Config

```json
{
  "platform": "DSCNeoHub",
  "name": "DSC Neo",
  "host": "localhost",
  "port": 8080,
  "userCode": "1234",
  "zones": [
    { "zone": 1, "name": "Front Door", "type": "contact" },
    { "zone": 5, "name": "Hall", "type": "motion" },
    { "zone": 8, "type": "hidden" }
  ]
}
```

| Field | Default | Notes |
|---|---|---|
| `host` / `port` | `localhost` / `8080` | NeoHub's web port (WebSocket at `/api/ws`). |
| `userCode` | none | Sent with arm/disarm. Omit to use NeoHub's default access code. |
| `commandTimeoutSeconds` | `15` | HomeKit reverts if the panel doesn't react in time. |
| `partitions[]` | | `{ partition, name }` to rename partitions. |
| `zones[]` | all `contact` | NeoHub doesn't report zone types, so set them here. |

## State mapping

| NeoHub | HomeKit |
|---|---|
| `disarmed` / `armed_home` / `armed_away` / `armed_night` | Off / Home / Away / Night |
| `arming` (exit delay) | "Arming…" (target set, current unchanged) |
| `pending` (entry delay) | stays armed |
| `triggered` | Alarm triggered |

## Development

```bash
npm install
npm test              # unit + client tests against a mock NeoHub
npm run mock -- 8090  # interactive mock NeoHub (type `help`)
npm run build
```

Security note: NeoHub's `/api/ws` has no authentication. Anything on the LAN can connect; disarming still requires a valid user code.
