# pi-refuseless

Refuseless provider for the [Pi coding agent](https://pi.dev): DeepSeek V4.1, GLM 5.3, Kimi K3.1 and MiniMax M3.1, including abliterated variants, over an OpenAI-compatible API.

The model list is fetched from `GET /v1/models` at startup and on every model refresh, so new models and price changes show up without a package update. Nothing is cached to disk.

## Install

```bash
pi install npm:pi-refuseless
```

or straight from source:

```bash
pi install git:github.com/kylinholmes/pi-refuseless
```

Then set a key, either way works:

```bash
export REFUSELESS_API_KEY=abl_...
```

or store it once and let Pi keep it:

```bash
pi login refuseless     # or /login inside Pi
```

Restart Pi or run `/reload`, then pick a model with `/model`.

## Models

The gateway currently serves DeepSeek V4.1 Flash (plain and abliterated), GLM 5.3 and GLM 5.3 Flash (abliterated), Kimi K3.1 Pro (plain and abliterated), and MiniMax M3.1 Flash. All are 1M context and vision-capable except GLM 5.3 Abliterated, which is text only. See the gateway's own `/v1/models` for the live list, or run `pi --list-models` after installing.

## What the provider reports

Per model, taken from upstream metadata:

| Upstream field | Pi model field |
| --- | --- |
| `vision` | `input: ["text", "image"]` or `["text"]` |
| `pricing.*` | `cost` (discounted price wins over `regular`) |
| `context_length` | `contextWindow` |
| `reasoning_efforts` | `reasoning` + `thinkingLevelMap` |

Names are derived from model ids. `maxTokens` is fixed at 65536.

Effort levels differ per model: DeepSeek accepts `off`, the others start at `low`. Pi clamps `minimal` and `medium` to `low`, and `xhigh` to `max`, so `/thinking` only offers what the model accepts.

## Balance

The provider does not ship a balance display. [`pi-usage-balances`](https://www.npmjs.com/package/pi-usage-balances) covers it with a declarative query:

```json
{
  "version": 1,
  "accounts": [
    {
      "id": "refuseless",
      "provider": "refuseless",
      "request": {
        "url": "https://api.refuseless.com/v1/credits",
        "method": "GET",
        "usePiAuth": true,
        "headers": { "Authorization": "Bearer ${token}" }
      },
      "response": {
        "metrics": [
          {
            "kind": "balance",
            "label": "balance",
            "remaining": { "path": "available" },
            "unit": { "value": "USD" }
          }
        ]
      }
    }
  ]
}
```

Put that in `~/.pi/agent/pi-usage.json`, then `/usage on`.

## Caveats

- Refuseless is a third-party gateway, not a first-party API vendor. It is not part of Pi's built-in catalog, and Pi's own `/models` page remains the authoritative list of supported providers.
- The catalog is read from the live API, so a network failure at startup leaves `/model` empty for that run.
- Model ids, prices and the `/v1/models` shape are the gateway's own; this package makes no promises about them.
- Abliterated models have no upstream price guarantee and can regress after a model update.

## Development

```bash
pi -e .              # load the package from source for one run
pi --list-models -e .
```

`index.ts` holds the whole package. There is no build step: Pi loads TypeScript directly.

## License

MIT
