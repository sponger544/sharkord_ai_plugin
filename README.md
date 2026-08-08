# Sharkord AI Chat Plugin

## Overview

A Sharkord plugin that connects to any OpenAI-compatible API (Ollama, vLLM, LiteLLM, Open-WebUI, etc.) for in-channel AI conversations with persistent context.

> **⚠️ AI-Generated Disclaimer**: This plugin, including all source code and documentation, was generated 100% by AI with very minor human supervision. Please review, test thoroughly in a non-production environment, and use at your own risk.

### 🙏 Shoutout

Huge thanks to the creator of Sharkord for building this awesome self-hosted chat server! If you enjoy using it, please consider supporting them:  

👉 [https://github.com/Sharkord/sharkord](https://github.com/Sharkord/sharkord)

## Features

* **OpenAI-Compatible API Support**: Works with Ollama, vLLM, LiteLLM, Open-WebUI, and any endpoint supporting `/v1/chat/completions`
* **Channel-Based Context**: Maintains separate conversation history per channel
* **Persistent Memory**: History survives server restarts via local JSON storage
* **Configurable Trigger**: Custom prefix (e.g., `@OpenAI` ) to initiate conversations
* **System Prompts**: Define custom personas, instructions, or behavioral constraints
* **Rate Limiting**: Prevents spam with per-channel cooldown timers
* **Per-User Token Limits**: Restricts token consumption per user per hour to prevent abuse
* **Concurrent Safety**: Serializes file I/O to prevent history corruption
* **Graceful Degradation**: Handles API errors, timeouts, and corrupted files without crashing
* **Configurable Response Name**: Modify the `name` field in `manifest.json` to change how the bot appears. Requires a rebuild (`bun run build`) and reinstalling the plugin into your Sharkord instance for changes to take effect.

## Configuration Settings

| Setting | Description | Default |
|---------|-------------|---------|
| API URL | Base URL of your OpenAI-compatible API instance (e.g., Ollama, vLLM, LiteLLM). Some endpoints like Open-WebUI may require the /api suffix to avoid a 405 error. | http://localhost:11434 |
| API Key | Optional Bearer token for authentication. Leave empty for local Ollama. | *(empty)* |
| Model Name | Name of the model to use (e.g., llama3.2, gpt-3.5-turbo, mistral). | llama3.2 |
| System Prompt | Optional system prompt sent to the model for behavior/persona customization. | You are an AI Chat bot in a sharkord chat server... |
| History Length | Number of recent messages to include as context (0-100 recommended). | 20 |
| Request Timeout | Seconds to wait for API response before timing out. | 120 |
| Rate Limit (seconds) | Minimum seconds between AI replies per channel (0 to disable). | 5 |
| Token Limit (per hour) | Maximum tokens a single user can consume per hour (0 to disable). | 0 |
| Trigger Prefix | Message prefix that triggers AI reply. Leave empty to disable. For ease of use, creating a dedicated user with no permissions makes it easier to call the model. | @OpenAI |


## Usage

Type a message starting with your configured prefix in any channel:

`@OpenAI What is the capital of France?`

The plugin captures the message, checks rate limits & token quotas, sends the request to your configured API with context, and posts the full response directly to the channel. Each channel maintains its own conversation history.

### Slash Commands

| Command | Description |
|---------|-------------|
| /chatbot | Displays instructions on how to trigger the AI bot. |
| /quota | Shows your remaining token quota for the current hour. |


## Installation & Build

### 1. Clone and Link Dependencies

Run the following commands in order:

```
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

### 2. Build the Plugin

When you're ready to build, run:

```
bun run build
```

This will create a `dist` folder containing the built plugin.

### 3. Install into Sharkord

1. Copy the entire `dist/` folder into your Sharkord plugins directory.
2. Restart your Sharkord server.
3. Configure settings via the admin panel under **Plugins → AI Chat → Settings**.