# pi-session-model

A standard [pi](https://pi.dev) package that adds a `/session-model` slash command.

`/session-model` switches the active model and thinking level for the **current pi session only**. It uses pi's runtime APIs (`pi.setModel()` and `pi.setThinkingLevel()`) and does **not** write to `~/.pi/agent/settings.json` or any other global config file.

## Install

From npm after publishing:

```bash
pi install npm:pi-session-model
```

For local development:

```bash
pi install /absolute/path/to/pi-session-model
# or try it for one run
pi -e /absolute/path/to/pi-session-model
```

## Usage

Open an interactive model + thinking-level picker:

```text
/session-model
```

Switch model only, preserving/clamping the current thinking level as pi normally does:

```text
/session-model anthropic/claude-sonnet-4-5
```

Switch model and thinking level together:

```text
/session-model anthropic/claude-sonnet-4-5:high
```

Change only the current session thinking level:

```text
/session-model off
/session-model medium
/session-model xhigh
```

Show the current runtime selection:

```text
/session-model current
```

## Notes

- Model names are resolved from pi's model registry, including custom models.
- The picker only shows thinking levels supported by each model.
- If credentials are missing for a selected model, pi refuses the switch and the package does not change global settings.

## Development

```bash
npm run typecheck
npm test
npm run check
```

## Package manifest

This package declares the extension in `package.json`:

```json
{
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```
