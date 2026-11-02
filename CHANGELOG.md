# Changelog

## [0.1.4] - 2026-10-01

### Changed

- Supports Pi 1.x.

## [0.1.3] - 2026-09-21

### Breaking Changes

- Requires Pi 0.86 or newer.

## [0.1.2] - 2026-07-10

### Breaking Changes

- `/session-model` with no matching model fails instead of opening a full-screen model picker.

### Added

- Supports the `max` thinking level, as in `/session-model anthropic/claude-sonnet-4-5:max`.

### Changed

- Argument completion uses the same fuzzy matching as the built-in `/model` command.

## [0.1.1] - 2026-06-10

### Added

- Initial release. The `/session-model` command switches the model and thinking level for the current session only, using `provider/model:thinking-level` syntax with argument completion.
