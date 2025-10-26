# OpenCode Context Analysis Plugin

Ever wonder where all your AI tokens are going? This plugin gives you a clear, visual breakdown of exactly how tokens are being used in your OpenCode sessions.

## 🎯 What It Does

- **See Your Token Usage**: Get instant insights into how tokens are distributed across your conversations
- **Track Individual Tools**: Find out which tools (`read`, `bash`, `webfetch`, etc.) consume the most tokens
- **Visual Charts**: Easy-to-read bar charts show percentages and counts at a glance
- **Smart Analysis**: Automatically identifies different types of content (system prompts, user messages, tools, etc.)
- **Works Everywhere**: Compatible with OpenAI, Claude, Llama, Mistral, DeepSeek, and more

## 🚀 Quick Start (3 Steps)

1. **Copy to your project**
   ```bash
   cp -r .opencode /path/to/your/opencode/project/
   ```

2. **Install dependencies**
   ```bash
   bash install.sh /path/to/your/opencode/project
   ```

3. **Restart OpenCode** and type `/context`

That's it! You'll see a detailed breakdown like this:
```
Context Analysis: Session abc123

SYSTEM    ███████████░░░░░░░░░░░░░░░ 15.2% (2,341)
USER      ████████████████████░░░░░░░ 29.6% (4,567)
ASSISTANT ████████████████████████████ 33.9% (5,234)
TOOLS     ████████░░░░░░░░░░░░░░░░░░░░ 12.2% (1,890)
REASONING █████░░░░░░░░░░░░░░░░░░░░░░░  9.1% (1,400)

Total: 15,432 tokens

Top Contributors:
• User#3           4,100 tokens (26.6%)
• Assistant#2      3,200 tokens (20.7%)
• System#MainPrompt 2,341 tokens (15.2%)
```



## 🛠️ Installation Options

### For a Single Project

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

### For All Projects (Global)

Want `/context` available everywhere? Install it globally:

1. **Copy to global config**
   ```bash
   cp -r .opencode ~/.config/opencode/
   ```

2. **Install globally**
   ```bash
   bash install.sh ~/.config/opencode/
   ```

3. **Restart OpenCode** - `/context` will work in any project

### Installation Summary

| Method      | Scope          | Command Location      | Use Case                          |
| ----------- | -------------- | --------------------- | --------------------------------- |
| **Project** | Single project | `.opencode/`          | Project-specific context analysis |
| **Global**  | All projects   | `~/.config/opencode/` | Universal access across projects  |

### Quick Test

After installation, type `/` in OpenCode and you should see `/context` in the suggestions. Try it:

```bash
/context                    # Basic analysis
/context detailed            # More detailed view
```

## 🔧 How It Works (The Tech Stuff)

**Dependencies**: The plugin uses two main libraries for accurate token counting:
- `js-tiktoken` - Official OpenAI tokenizer for GPT models
- `@huggingface/transformers` - Hugging Face tokenizers for Claude, Llama, Mistral, etc.

**Installation Process**: The `install.sh` script automatically:
1. Installs these tokenizer libraries to a local `vendor` directory
2. Sets up the plugin files in the right locations
3. Ensures everything works without affecting your main project

**Privacy**: All token counting happens locally on your machine. No data is sent to external services.

## 📖 Usage Guide

### Basic Commands

```bash
/context                    # Standard analysis
/context detailed            # More detailed breakdown
/context short               # Quick summary
/context verbose             # Everything included
```

### Advanced Options

**Custom verbosity** - Use any description you want:
```bash
/context "extremely detailed"  # Maximum detail
/context "just the basics"     # Minimal info
/context "focus on tools"      # Whatever you prefer
```

**Specific sessions**:
```bash
/context sessionID:your-session-id
```

**Limit analysis depth**:
```bash
/context limitMessages:5    # Only analyze last 5 messages
```

### What You'll Learn

- **Which tools cost the most** - See if `bash`, `read`, or `webfetch` are using the most tokens
- **System prompt impact** - Understand how much context is being set up
- **Your conversation patterns** - See if you're writing long prompts or getting long responses
- **Reasoning costs** - For models that support it, see how much reasoning tokens cost

### Manual Installation (Advanced)

If you prefer to set things up yourself:

1. Copy the `.opencode` directory to your OpenCode project
2. Install tokenizer dependencies manually:
   ```bash
   npm install js-tiktoken@latest @huggingface/transformers@^3.3.3 --prefix .opencode/plugin/vendor
   ```



## 🔧 How It Works

The plugin uses two main libraries for accurate token counting:
- `js-tiktoken` - Official OpenAI tokenizer for GPT models
- `@huggingface/transformers` - Hugging Face tokenizers for Claude, Llama, Mistral, etc.

The `install.sh` script automatically installs these to a local `vendor` directory and sets up everything without affecting your main project. All token counting happens locally on your machine - no data is sent to external services.

## 🛠️ Development

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
