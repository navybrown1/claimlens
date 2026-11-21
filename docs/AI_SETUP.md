# ClaimLens AI setup

ClaimLens works without AI. Imports, deterministic policy checks, review decisions, analytics, and saved audit runs do not need an API key. AI is optional and only runs after a person requests it.

## Connect a provider

1. Open **AI copilot** and find **Your AI connection** in ClaimLens.
2. Choose **OpenRouter**, **OpenAI**, **Anthropic**, or **Google Gemini**.
3. Enter a key from that provider's developer account. For OpenRouter, you can alternatively choose a protected Vercel server key and enter your workspace access code. Consumer AI subscriptions are not themselves developer API keys.
4. Use the suggested model or enter a model ID available to your provider account.
5. Test the connection. This sends a small generation request and can consume provider credits.
6. Ask a question, request an audit summary, explain a selected claim, draft a follow-up, or extract a receipt.

Directly entered API keys and workspace access codes are held only in the current app's memory. They are not saved to localStorage, sessionStorage, audit exports, GitHub, or a database. Refreshing the app or disconnecting clears them. An optional OpenRouter API key is stored separately as a Vercel secret and can be used only with a distinct access code. Do not paste API keys into the chat box or claim data.

### Suggested models

These model IDs were checked against provider documentation on November 20, 2026. Availability and billing depend on the provider account. The model field is editable so the app can continue working when provider offerings change.

| Provider      | Suggested model         | API used                                                                               |
| ------------- | ----------------------- | -------------------------------------------------------------------------------------- |
| OpenRouter    | `openai/gpt-4o-mini`    | `POST https://openrouter.ai/api/v1/chat/completions`                          |
| OpenAI        | `gpt-6-luna`            | `POST https://api.openai.com/v1/responses`                                             |
| Anthropic     | `claude-haiku-5-5`      | `POST https://api.anthropic.com/v1/messages`                                           |
| Google Gemini | `gemini-3.5-flash-lite` | `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` |

No custom provider URL is accepted. OpenRouter allows namespaced `provider/model` identifiers; direct providers do not allow slashes. The server uses only the four allowlisted provider hosts and rejects redirects.

## What is sent

A normal copilot chat request sends the typed question, up to six recent user/assistant messages (each capped at 1,500 characters), selected policy values, full-run counts and separate totals for each currency, plus at most 60 individual claims. Claim details are ordered by rule-based risk, with the selected claim first when applicable. The context explicitly states how many claims were omitted.

Included individual claim fields are claim ID, a generated employee reference such as `Employee 1`, department, merchant, category, dates, amount, currency, receipt-present flag, mileage when supplied, rule-based status/score, and concise rule findings. The original employee name and employee ID fields, free-text descriptions, reviewer notes, and review decisions are excluded. A second server-side allowlist applies the same boundary. This is data minimization, not a guarantee of anonymity: merchant names, claim IDs, departments, and the text a person types can still contain sensitive information.

A connection test does not send claim data. Receipt extraction sends the selected image to the selected provider. Images can contain names and other personal details, so inspect or crop the image before requesting extraction. ClaimLens does not upload images until extraction is requested.

Requests pass through the app's Vercel function over HTTPS, then to the selected provider. The key is used only for that request. The server has no shared key by default. Only if the separate Vercel OpenRouter key and workspace access code are configured can a user with the access code make a billed request on the site owner's account. OpenAI requests set `store: false`; provider-side processing, abuse monitoring, retention, and billing remain governed by the selected provider and account settings. `store: false` is not a zero-retention guarantee.

## Capabilities and limits

- **Ask about the audit:** answer questions using the supplied context and reference claim IDs.
- **Summarize:** create a compact summary with full-run counts and next review steps.
- **Explain a claim:** describe supplied rule findings, policy thresholds, and missing evidence.
- **Draft a follow-up:** prepare a neutral email draft. The app does not send it.
- **Read a receipt:** extract a draft merchant, date, total, currency, category, and description. PNG, JPEG, and WebP are accepted up to 2.5 MiB. This limit accommodates base64 expansion within the deployment request limit. The server validates image signatures and parses a strict field allowlist from the model response.

AI answers are suggestions. They do not change deterministic findings, approve or reject claims, or make payments. The model is instructed to treat imported strings and images as untrusted data and not follow embedded instructions. No execution, browsing, email, or payment tools are provided to the model.

Every extracted receipt field must be compared with the original. Unreadable fields are left absent, ambiguous currencies should not be guessed, and invalid dates or nonnumeric totals are rejected from the draft. An extraction response never creates a claim automatically.

The copilot uses one request per action and does not maintain a provider-hosted conversation. For chat, the UI can send up to six recent messages held in memory. Each message is capped at 1,500 characters, and the server accepts only user/assistant roles with a total ceiling of 10,000 characters. Prior messages are included as clearly delimited, untrusted conversation JSON before the current question. They may contain names or details you previously typed. Summary, explanation, draft, connection-test, and receipt actions do not accept chat history. The current workspace is the authoritative source for present claim facts. Clearing the chat removes its in-memory messages.

### OpenRouter server-key configuration

**Option A, direct key (recommended for a public demo):** select OpenRouter in the copilot and paste your own OpenRouter developer key; this is held only in the tab and used for explicit requests. The production environment variables are not needed for this mode.

**Option B, protected Vercel key:** in the ClaimLens Vercel project configure two **Production** secrets:

1. `OPENROUTER_API_KEY`: a valid OpenRouter API key.
2. `CLAIMLENS_ACCESS_TOKEN`: a separate, strong random access code, ideally at least 32 random bytes, never the OpenRouter API key.

Redeploy after setting either secret. In ClaimLens select **OpenRouter**, enable **Use OpenRouter key stored in Vercel**, and enter the distinct workspace access code. The server uses a constant-time comparison of SHA-256 hashes before it reads the provider key. Missing configuration fails closed with HTTP 503; wrong codes fail with HTTP 401. It never sends the OpenRouter key to the frontend.

**Security limit:** this is an access code, not full authentication, organizational roles, user accounts, or rate limiting. Enable Vercel Deployment Protection, use an OpenRouter key with spending limits, and do not share the code. A public unprotected endpoint with a compromised code can consume API credits. The app never transmits complete import files when you merely upload them; explicit AI requests do send the allowed context or receipt image to the chosen provider.

## Developer setup

The server handler is `api/ai.ts`. It accepts a Node `IncomingMessage` and `ServerResponse`, with either a parsed `req.body` from Vercel or a raw JSON request stream. Direct user-key requests do not need environment variables or provider SDKs. Optional protected OpenRouter server-key mode requires two production environment variables, as described below. It is deployable as a Vercel Node function: Vercel automatically compiles TypeScript entry points in the root `api/` directory. The current Vercel documentation supports the Node request/response signature and an exported configuration object for Node `/api` routes. `api/ai.ts` exports `config = { maxDuration: 60 }`. The handler also catches errors from Vercel's lazy parsed-body getter and returns a safe HTTP 400.

The frontend helper is `src/lib/ai.ts`. `requestAI(config, input)` sends a same-origin JSON POST to `/api/ai`, includes only same-origin authentication cookies when Vercel deployment protection is enabled, disables HTTP caching, and has a 55-second client timeout. Browser cookies are not forwarded to the upstream AI provider. The server sets no-store response headers and aborts the upstream request after 45 seconds. Configure the Vercel function for at least 60 seconds if the project's runtime default is lower.

The endpoint requires a same-origin `Origin` header and rejects cross-site browser requests. Local HTTP is supported only for localhost/loopback. Browser applications must use HTTPS in production. This origin check reduces accidental cross-site use; it is not an authenticated user system and should not be described as one.

The server accepts only supported actions and providers, validates model and key syntax, bounds JSON/context/image sizes, caps output tokens, and replaces upstream error details with safe user-facing messages. Provider errors and secrets are never intentionally logged. Receipt drafts are validated before return. Always render AI output as escaped text or with a rigorously sanitized Markdown renderer.

### Tests

Run:

```sh
npm test -- --run tests/ai.test.ts
```

The tests cover provider request shapes, source-to-model privacy boundaries, currency separation, context truncation, same-origin enforcement, malformed/oversized inputs, key handling, timeout behavior, safe errors, bounded conversation history, image signature validation, and strict receipt parsing. Provider requests are mocked. Passing these tests does **not** prove that a live user key has credit or access to a given model. Verify that with the in-app connection test.

## Troubleshooting

| Message                                    | What to check                                                                                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add your API key                           | Enter a provider developer API key in AI copilot > Your AI connection.                                                                                                  |
| Provider rejected this key or model access | Key validity, restricted permissions, provider selection, and model access.                                                                                             |
| Provider rate or credit limit reached      | Provider dashboard quota, credit, billing, or temporary request rate.                                                                                                   |
| Provider could not use model or input      | Exact model ID and text/vision support.                                                                                                                                 |
| Request timed out                          | Try again with a smaller context or faster model.                                                                                                                       |
| Receipt too large                          | Resize or crop to PNG/JPEG/WebP under 2.5 MiB.                                                                                                                          |
| Provider returned no readable answer       | The output budget may have been used by reasoning, content may have been refused, or the selected model may use a different output mode. Choose a supported text model. |

## Official implementation references

1. [OpenAI developer quickstart](https://developers.openai.com/api/docs/quickstart)
2. [OpenAI Responses API request fields and image inputs](https://developers.openai.com/api/reference/resources/responses/methods/create)
3. [OpenAI model catalog](https://developers.openai.com/api/docs/models)
4. [GPT-6 Luna model](https://developers.openai.com/api/docs/models/gpt-6-luna)
5. [OpenAI data controls and retention](https://developers.openai.com/api/docs/guides/your-data)
6. [Anthropic model catalog](https://platform.claude.com/docs/en/models/overview)
7. [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create)
8. [Anthropic API versioning](https://platform.claude.com/docs/en/api/versioning)
9. [Anthropic vision inputs](https://platform.claude.com/docs/en/build-with-claude/vision)
10. [Google model catalog](https://aistudio.google.com/docs/models)
11. [Google generateContent API](https://aistudio.google.com/api-reference/generate-content/generate-content)
12. [Google image understanding](https://aistudio.google.com/docs/image-understanding)

These are independent documentation pages from three providers, not twelve independent evaluations of AI accuracy. The app-specific behavior above is established by the source code and automated tests; provider capability claims come from the official references.

### Deployment references

- [Vercel Node.js runtime, TypeScript, request/response objects, and parsed request bodies](https://vercel.com/docs/functions/runtimes/node-js)
- [Vercel maximum duration configuration](https://vercel.com/docs/functions/configuring-functions/duration)

This repository uses one root API entry point. Do not add a catch-all rewrite that sends `/api/ai` to the SPA's `index.html`. If additional API utility modules are needed later, keep them outside `api/` so Vercel does not turn each module into an endpoint.
