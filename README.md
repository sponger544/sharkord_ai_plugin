
# Sharkord AI Chat Plugin

> **⚠️ AI-Generated Disclaimer**: This plugin, including all source code and documentation (`README.md`), was generated 100% by AI with very minor human supervision. Please review, test thoroughly in a non-production environment, and use at your own risk.

Thanks to the creator for making this awesome chat server! Please support the [them!](https://github.com/Sharkord/sharkord)

Connect your Sharkord server to any OpenAI-compatible API (Ollama, vLLM, LiteLLM, Open-WebUI, etc.) for in-channel AI conversations with persistent context.

## Features

- **OpenAI-Compatible API Support**: Works with Ollama, vLLM, LiteLLM, Open-WebUI, and any endpoint supporting `/v1/chat/completions`
- **Channel-Based Context**: Maintains separate conversation history per channel
- **Persistent Memory**: History survives server restarts via local JSON storage
- **Configurable Trigger**: Custom prefix (e.g., `@OpenAI `) to initiate conversations
- **System Prompts**: Define custom personas, instructions, or behavioral constraints
- **Rate Limiting**: Prevents spam with per-channel cooldown timers
- **Concurrent Safety**: Serializes file I/O to prevent history corruption
- **Graceful Degradation**: Handles API errors, timeouts, and corrupted files without crashing
- **Token Tracking**: Track token usage per-user, resets every hour. Check token usage with /quota
- **Configurable Response Name**: Modifying the **Name** in manifest.json will change the bot's name. Must rebuild and move the plugin.

## Installation

### Prerequisites

- Sharkord server running
- OpenAI-compatible API instance accessible from the server

### Setup

1. **Build the plugin** (if not already built):
   ```bash
   git clone https://github.com/sponger544/sharkord_ai_plugin
   cd sharkord_ai_plugin
   git clone https://github.com/Sharkord/sharkord.git
   cd sharkord
   bun install
   cd packages/plugin-sdk
   bun link
   cd ../ui
   bun link
   cd ../../
   git clone https://github.com/Sharkord/plugin-builder.git
   cd plugin-builder
   bun install
   bun link
   cd ../../
   bun link @sharkord/plugin-sdk
   bun link @sharkord/ui
   bun link @sharkord/plugin-builder
   ```
1.1 When you're ready to build, run the following command. It will create the folder `dist` with the built plugin
   ```bash
   bun run build
   ```

2. **Install the plugin** into your Sharkord instance:
   - Copy the `dist/` folder to your Sharkord plugins directory
   - Restart your Sharkord server
     ```bash
     docker restart sharkord
     ```

3. **Configure settings** via the Sharkord admin panel:
   - Navigate to **Plugins → AI Chat → Settings**
   - Configure the options below

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| **API URL** | Base URL of your OpenAI-compatible API instance. Some endpoints (Open-WebUI) may require the `/api` suffix, otherwise you will get a 405 error. | `http://localhost:11434` |
| **API Key** | Optional Bearer token for authentication. Leave empty for local Ollama. | *(empty)* |
| **Model Name** | Name of the model to use (e.g., `llama3.2`, `gpt-3.5-turbo`, `mistral`) | `llama3.2` |
| **System Prompt** | Optional system prompt sent to the model for behavior/persona customization | `You are an AI Chat bot in a sharkord chat server...` |
| **History Length** | Number of recent messages to include as context (0-100 recommended) | `20` |
| **Request Timeout** | Seconds to wait for API response before timing out | `120` |
| **Rate Limit (seconds)** | Minimum seconds between AI replies per channel (0 to disable) | `5` |
| **Trigger Prefix** | Message prefix that triggers AI reply. Leave empty to disable. For ease of use, creating a dedicated user with no permissions makes it easier to call the model. | `@OpenAI ` |

## Usage

### Triggering AI Responses

Type a message starting with your configured prefix in any channel:

```
@OpenAI What is the capital of France?
```

The plugin will:
1. Capture the message and add it to channel history
2. Check rate limits (if enabled)
3. Send the request to your configured API with context
4. Post the full response directly to the channel

### Channel Context

Each channel maintains its own conversation history. The AI will remember previous messages within the configured history length, enabling contextual follow-ups:

```
@OpenAI Explain quantum computing
@OpenAI Can you give me a real-world example?
@OpenAI How does this relate to cryptography?
```

### History Management

- History files are stored in `{plugin_dir}/history/channel-{id}.json`
- Files persist across server restarts
- Corrupted files are automatically reset
- History is trimmed to the configured length automatically

## Troubleshooting

### Common Issues

| Problem | Solution |
|---------|----------|
| **405 Method Not Allowed** | Add `/api` suffix to your API URL (e.g., `http://localhost:3000/api`) |
| **401 Unauthorized** | Set your API Key in the plugin settings |
| **Timeout errors** | Increase the Request Timeout setting or use a smaller/faster model |
| **No response** | Verify your API URL is accessible from the Sharkord server |
| **History not persisting** | Check that the plugin has write permissions to its directory |

### Debugging

- Enable debug logging in your Sharkord server configuration
- Check plugin logs for API errors and connection issues
- Verify history files are being created in the `history/` directory

## Technical Details

- **API Endpoint**: `/v1/chat/completions` (OpenAI-compatible)
- **Message Format**: Standard OpenAI messages array with `role` and `content`
- **History Storage**: JSON files per channel in `{plugin_dir}/history/`
- **Concurrency**: Serialized file I/O per channel to prevent corruption
- **Rate Limiting**: In-memory per-channel cooldown (resets on plugin reload)

## Requirements

- Sharkord server (latest version recommended)
- OpenAI-compatible API endpoint
- Network access from Sharkord server to API endpoint
