# homebridge-dsc-neohub

Homebridge plugin for DSC PowerSeries Neo panels, via a local [NeoHub](https://github.com/BrianHumlicek/NeoHub) server talking ITv2 to a TL280(E) communicator. Fully local; no Alarm.com.

- Each partition → **Security System** (Home / Away / Night / Off, alarm triggered).
- Each zone → **sensor** (contact, motion, smoke, leak, CO, or hidden). Bypassed zones show as inactive.
- If NeoHub or the panel is unreachable, accessories show **No Response** rather than stale state.

## Install

Search for **homebridge-dsc-neohub** in the Homebridge UI's Plugins tab, or:

```bash
npm install -g homebridge-dsc-neohub
```

Then add the platform below (or use the plugin's settings form) and restart Homebridge.

## Releasing

Releases are automatic. Every other day the Release workflow checks whether anything that ships changed since the latest `v*` tag; if so it bumps the patch version, publishes to npm with provenance (via trusted publishing, no token), and creates the tag and GitHub release. Run it now with `gh workflow run release.yml`.

For a minor or major version, publish a GitHub release by hand (for example `v0.2.0`); mark it as a prerelease to publish under the `beta` dist-tag. Version bumps are not committed back to `main`, so git tags, not `package.json`, are the version history.

Dependabot patch and minor updates merge themselves once the `test` check passes.

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
