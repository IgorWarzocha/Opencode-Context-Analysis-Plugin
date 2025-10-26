# OpenCode Context Analysis Plugin

A powerful OpenCode plugin that provides detailed token usage analysis for your AI sessions. Track and understand how tokens are distributed across system prompts, user messages, assistant responses, tool outputs, and reasoning traces.

## Features

- **Comprehensive Token Analysis**: Breakdown of token usage across different message types
- **Multi-Model Support**: Compatible with OpenAI, Anthropic Claude, Llama, Mistral, DeepSeek and more
- **Real-time Session Monitoring**: Analyze current session context and token distribution
- **Intelligent Tokenization**: Uses model-specific tokenizers for accurate counting
- **Top Contributors Identification**: Quickly identify which parts of your session consume the most tokens

## Installation

### Quick Setup

1. **Copy Plugin Files**

   ```bash
   cp -r .opencode /path/to/your/opencode/project/
   ```

2. **Install Dependencies**

   ```bash
   bash install.sh /path/to/your/opencode/project
   ```

   Or install to current directory:

   ```bash
   bash install.sh .
   ```

3. **Restart OpenCode** and the `/context` command will be available

### Global Installation

To make the `/context` command available across all OpenCode projects:

1. **Install to Global Config Directory**

   ```bash
   cp -r .opencode ~/.config/opencode/
   ```

2. **Install Dependencies Globally**

   ```bash
   bash install.sh ~/.config/opencode/
   ```

3. **Verify Installation**

   ```bash
   ls ~/.config/opencode/command/context.md
   ls ~/.config/opencode/plugin/context-usage.ts
   ```

4. **Restart OpenCode** - the `/context` command will now be available in every project

### Installation Methods Summary

| Method      | Scope          | Command Location      | Use Case                          |
| ----------- | -------------- | --------------------- | --------------------------------- |
| **Project** | Single project | `.opencode/`          | Project-specific context analysis |
| **Global**  | All projects   | `~/.config/opencode/` | Universal access across projects  |

### Verification

After installation, the `/context` command should appear in OpenCode's command suggestions when you type `/`. Test it with:

```bash
/context                    # Current session (concise)
/context detailed            # Current session (detailed)
```

### Manual Installation

If you prefer manual setup:

1. Copy the `.opencode` directory to your OpenCode project root
2. Install tokenizer dependencies:
   ```bash
   npm install js-tiktoken@latest @huggingface/transformers@^3.3.3 --prefix .opencode/plugin/vendor
   ```

## Usage

### Basic Usage

Run the context analysis command in any OpenCode session:

```
/context
```

This will display:

- Session ID and model information
- Total token count
- Breakdown by category (system, user, assistant, tools, reasoning)
- Top contributors with individual tool names
- Intelligent system prompt identification

### Advanced Usage

Control output verbosity with flexible arguments:

```
/context                    # Concise summary (default)
/context detailed            # Detailed summary
/context short               # Short summary
/context verbose             # Verbose summary
/context "extremely detailed" # Custom verbosity
/context "whatever you want"  # Fully flexible
```

**How it works:**

- The `$ARGUMENTS` placeholder gets replaced directly in the command template
- You can use any descriptive term: "short", "concise", "detailed", "verbose", "extremely detailed", etc.
- The command adapts to whatever verbosity level you prefer
- No predefined options - completely flexible and user-controlled

Analyze a specific session:

```
/context sessionID:your-session-id
```

### Enhanced Features

- **Individual Tool Tracking**: See exactly which tools (`read`, `bash`, `webfetch`, etc.) consume the most tokens
- **Smart System Prompt Identification**: Automatically identifies and names system prompts (System#MainPrompt, System#Permissions, etc.)
- **Accurate Token Counting**: Uses model-specific tokenizers for precise measurements
- **Clean Visual Output**: Simplified display without ASCII table borders
  /context

```

This will display:
- Session ID and model information
- Total token count
- Breakdown by category (system, user, assistant, tools, reasoning)
- Top token contributors

### Advanced Usage

Limit the number of message entries to analyze:

```

/context limitMessages:5

```

Analyze a specific session:

```

/context sessionID:your-session-id

```

## Sample Output

```

Session abc123 · model claude-3.5-sonnet · total 15,432 tokens
Breakdown — system 2,341 | user 4,567 | assistant 5,234 | tools 1,890 | reasoning 1,400
Top contributors: User#3 4,100, Assistant#2 3,200, System#1 2,341

```

## How It Works

### Tokenization Engine

The plugin uses a sophisticated multi-tier tokenization approach leveraging Hugging Face Transformers:

**Hugging Face Integration**: The core tokenization is powered by `@huggingface/transformers`, which provides access to the exact tokenizers used by each model family. This ensures accurate token counting that matches what the actual AI models see.

**Model Detection**: The plugin automatically detects the model being used in your session and selects the appropriate tokenizer from Hugging Face Hub or falls back to provider-specific defaults.

**Tiktoken Support**: For OpenAI models, the plugin uses `js-tiktoken` which provides the official OpenAI tokenization compatible with GPT models.

**Smart Fallbacks**: When specific tokenizers aren't available, the plugin uses intelligent fallbacks based on model families and providers, ensuring you always get meaningful token estimates.

## Technical Details

### Architecture

The plugin consists of:

- **Command Definition** (`.opencode/command/context.md`): Defines the `/context` slash command
- **Plugin Implementation** (`.opencode/plugin/context-usage.ts`): Core TypeScript plugin with tokenization logic
- **Installation Script** (`install.sh`): Automated dependency installation

### Token Counting Strategy

The plugin implements a hierarchical tokenization approach:

1. **Exact Model Matching**: Loads the specific tokenizer from Hugging Face Hub that corresponds to your model (e.g., `Xenova/claude-tokenizer` for Claude models, `Xenova/Meta-Llama-3.1-Tokenizer` for Llama)

2. **Provider-Based Fallbacks**: When exact model tokenizers aren't found, falls back to provider defaults (Anthropic → Claude tokenizer, Meta → Llama tokenizer, etc.)

3. **Tiktoken Integration**: OpenAI models use the official `js-tiktoken` library with model-specific encodings (`gpt-4o`, `gpt-3.5-turbo`, etc.)

4. **Character-Based Estimation**: Final fallback uses approximate token counting (text length ÷ 4) when tokenizers fail to load

### Real-Time Analysis

The plugin analyzes your session in real-time by:
- Extracting all message content by type (system prompts, user input, assistant responses, tool outputs, reasoning traces)
- Applying the appropriate tokenizer to each content piece
- Reconciling with actual API token usage when available through OpenCode's telemetry
- Providing breakdown and identifying the highest token consumers

### Performance Features

- **Caching**: Tokenizers are cached for performance
- **Telemetry Integration**: Uses actual token usage from API responses when available
- **Concurrent Processing**: Analyzes different message categories in parallel

## Development

### Project Structure

```

.
├── .opencode/
│ ├── command/
│ │ └── context.md # Command definition
│ └── plugin/
│ └── context-usage.ts # Main plugin implementation
├── install.sh # Dependency installer
└── README.md # This file

```

### Building and Testing

The plugin is written in TypeScript and runs directly in the OpenCode environment. No build step is required.

To test locally:
1. Install in a test OpenCode project
2. Start a session and run `/context`
3. Verify token analysis appears correctly

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is open source. See the repository for license details.

## Support

For issues, questions, or contributions:
- Open an issue on GitHub
- Check OpenCode documentation for plugin development
- Review the source code for implementation details

---

**Made for [OpenCode](https://opencode.ai)** - Enhance your AI development workflow with detailed context analysis.
```
