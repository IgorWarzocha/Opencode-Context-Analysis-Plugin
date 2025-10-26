# OpenCode Context Analysis Plugin - Agent Guidelines

## Build & Test Commands

- **Install dependencies**: `bash install.sh` (installs to current directory) or `bash install.sh /path/to/project`
- **Test plugin**: Install in OpenCode project and run `/context` command
- **No build step required**: TypeScript runs directly in OpenCode environment

## Code Style Guidelines

### Imports & Dependencies
- Use ES6 imports with `@opencode-ai/plugin` for core functionality
- Import external libraries from vendor directory: `js-tiktoken`, `@huggingface/transformers`
- Use `zod/v4` for schema validation
- Node.js built-ins: `path`, `fs/promises`, `url`

### TypeScript Conventions
- Use `interface` for object types, `type` for unions/primitives
- Async functions with proper error handling using try/catch
- Optional chaining (`?.`) and nullish coalescing (`??`) for safety
- Explicit return types for public functions

### Naming Conventions
- PascalCase for interfaces/types: `SessionMessage`, `TokenModel`
- camelCase for variables/functions: `buildContextSummary`, `tokenModel`
- UPPER_SNAKE_CASE for constants: `ENTRY_LIMIT`, `vendorRoot`
- Descriptive function names: `identifySystemPrompt`, `collectToolOutputs`

### Error Handling
- Throw descriptive errors for missing dependencies
- Graceful fallbacks for tokenizer failures (character-based estimation)
- Validate inputs early with clear error messages
- Use try/catch for external library calls with fallbacks

### Code Organization
- Export main plugin as `ContextUsagePlugin`
- Group related functions together (collectors, formatters, tokenizers)
- Use Map for caching: `tiktokenCache`, `transformerCache`
- Separate data transformation from presentation logic