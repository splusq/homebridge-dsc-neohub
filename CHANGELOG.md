# Changelog

Releases after 0.1.2 are published automatically and their notes live on the
[GitHub releases page](https://github.com/splusq/homebridge-dsc-neohub/releases).

## 0.1.2

- Releases now publish from GitHub Actions via npm trusted publishing (no stored npm token).

## 0.1.1

- First release published to npm, so updates show up in the Homebridge UI.
- Releases are now built, tested, and published by GitHub Actions (with npm provenance).

## 0.1.0

- Initial release.
- Each DSC partition is a HomeKit Security System (Home / Away / Night / Off, alarm triggered).
- Each zone is a contact, motion, smoke, leak, or CO sensor, or hidden; bypassed zones show inactive.
- Accessories show No Response while NeoHub or the panel is offline, and recover on reconnect.
- HomeKit reverts its target when the panel rejects or ignores an arm/disarm command.
