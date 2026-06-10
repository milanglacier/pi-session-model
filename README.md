# pi-session-model

A standard [pi](https://pi.dev) package that adds a `/session-model` slash command.

`/session-model` switches the active model and optional thinking level for the **current pi session only**. It does not leave changes in `~/.pi/agent/settings.json` or other global defaults.

## Install

From npm after publishing:

```bash
pi install npm:pi-session-model
```

Or install via github

```bash
pi install github:milanglacier/pi-session-model
```

For local development:

```bash
pi install /absolute/path/to/pi-session-model
# or try it for one run
pi -e /absolute/path/to/pi-session-model/src/index.ts
```

## Usage

Open a model picker:

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

Supported thinking levels are `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`.

Argument completion suggests providers and `provider/model` references.

## Notes

- Model references are resolved from pi's model registry, including custom models.
- If credentials are missing for a selected model, pi refuses the switch.
- The package uses pi's runtime model/thinking APIs and restores global default model/thinking settings on pi versions where those APIs persist defaults.

## Development

```bash
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
