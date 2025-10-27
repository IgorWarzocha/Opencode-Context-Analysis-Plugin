export type TokenizerSpec =
  | { kind: "tiktoken"; model: string }
  | { kind: "transformers"; hub: string }
  | { kind: "approx" }

export interface TokenizerEntry {
  alias: string
  spec: TokenizerSpec
}

export interface TokenizerRegistry {
  openai: Map<string, TokenizerEntry>
  transformers: Map<string, TokenizerEntry>
  providerDefaults: Map<string, TokenizerSpec>
  defaultOpenAI?: TokenizerEntry
}

export interface TokenModel {
  name: string
  spec: TokenizerSpec
}

export interface SessionMessageInfoShape {
  modelID?: string
  providerID?: string
}

export interface SessionMessageShape {
  info?: SessionMessageInfoShape
}

export declare class TokenizerResolutionError extends Error {
  constructor(message: string, details?: { models?: string[]; providers?: string[] })
  readonly models: string[]
  readonly providers: string[]
}

export declare function resolveTokenModel(messages: readonly SessionMessageShape[]): Promise<TokenModel>
export declare function loadTokenizerRegistry(): Promise<TokenizerRegistry>
export declare function resetTokenizerRegistryCache(): void
export declare function suggestTokenizerAlias(
  registry: TokenizerRegistry,
  modelID: string,
): TokenizerEntry | undefined
