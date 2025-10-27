import path from "path"
import fs from "fs/promises"
import { fileURLToPath } from "url"

const moduleRoot = path.dirname(fileURLToPath(import.meta.url))
const vendorRoot = path.join(moduleRoot, "vendor", "node_modules")
const OPENAI_PROVIDERS = new Set(["openai", "azure", "opencode"])

let registryPromise

export class TokenizerResolutionError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = "TokenizerResolutionError"
    this.models = Array.isArray(details.models) ? details.models : []
    this.providers = Array.isArray(details.providers) ? details.providers : []
  }
}

export async function resolveTokenModel(messages) {
  const registry = await loadTokenizerRegistry()
  const reversed = [...messages].reverse()
  const seenModels = []
  const seenProviders = []

  for (const message of reversed) {
    const originalModel = message?.info?.modelID
    const originalProvider = message?.info?.providerID
    const modelID = normalizeModelKey(originalModel)
    const providerID = normalizeProviderKey(originalProvider)

    if (modelID && !seenModels.some((entry) => entry.model === modelID)) {
      seenModels.push({ model: modelID, original: originalModel ?? modelID })
    }
    if (providerID && !seenProviders.some((entry) => entry.provider === providerID)) {
      seenProviders.push({ provider: providerID, original: originalProvider ?? providerID })
    }

    const resolved = resolveFromHints({ modelID, providerID, originalModel, registry })
    if (resolved) return resolved
  }

  for (const { provider, original } of seenProviders) {
    const spec = registry.providerDefaults.get(provider)
    if (spec) {
      return { name: original, spec }
    }
  }

  for (const { model, original } of seenModels) {
    const suggestion = suggestTokenizerAlias(registry, model)
    if (suggestion) {
      return { name: original, spec: suggestion.spec }
    }
  }

  throw new TokenizerResolutionError(
    "No tokenizer could be resolved for the current session.",
    {
      models: seenModels.map((entry) => entry.original),
      providers: seenProviders.map((entry) => entry.original),
    },
  )
}

export async function loadTokenizerRegistry() {
  if (!registryPromise) {
    registryPromise = buildTokenizerRegistry()
  }
  return registryPromise
}

export function resetTokenizerRegistryCache() {
  registryPromise = undefined
}

function resolveFromHints({ modelID, providerID, originalModel, registry }) {
  if (providerID && OPENAI_PROVIDERS.has(providerID)) {
    const entry = lookupOpenAIModel(registry, modelID)
    if (entry) {
      return { name: originalModel ?? entry.alias, spec: entry.spec }
    }
    if (!modelID && registry.defaultOpenAI) {
      return { name: originalModel ?? registry.defaultOpenAI.alias, spec: registry.defaultOpenAI.spec }
    }
  }

  if (modelID) {
    const openaiEntry = lookupOpenAIModel(registry, modelID)
    if (openaiEntry) {
      return { name: originalModel ?? openaiEntry.alias, spec: openaiEntry.spec }
    }

    const transformerEntry = lookupTransformersModel(registry, modelID)
    if (transformerEntry) {
      return { name: originalModel ?? transformerEntry.alias, spec: transformerEntry.spec }
    }
  }

  if (providerID) {
    const providerSpec = registry.providerDefaults.get(providerID)
    if (providerSpec) {
      return { name: originalModel ?? providerID, spec: providerSpec }
    }
  }

  return undefined
}

function lookupOpenAIModel(registry, modelID) {
  if (!modelID) return undefined
  const direct = registry.openai.get(modelID)
  if (direct) return direct
  const trimmed = modelID.replace(/-latest$/, "")
  if (trimmed !== modelID) {
    return registry.openai.get(trimmed)
  }
  const base = modelID.split(":")[0]
  if (base && base !== modelID) {
    return registry.openai.get(base)
  }
  return undefined
}

function lookupTransformersModel(registry, modelID) {
  if (!modelID) return undefined
  const direct = registry.transformers.get(modelID)
  if (direct) return direct
  const base = modelID.split(":")[0]
  if (base && base !== modelID) {
    return registry.transformers.get(base)
  }
  return undefined
}

export function suggestTokenizerAlias(registry, modelID) {
  const entries = uniqueEntries(registry)
  let best
  for (const entry of entries) {
    const score = similarity(modelID, entry.matchKey)
    if (score >= 0.5 && (!best || score > best.score)) {
      best = { entry, score }
    }
  }
  return best?.entry ?? undefined
}

function uniqueEntries(registry) {
  const bucket = new Map()
  for (const [key, entry] of registry.openai.entries()) {
    if (!bucket.has(entry.alias)) {
      bucket.set(entry.alias, { ...entry, matchKey: key })
    }
  }
  for (const [key, entry] of registry.transformers.entries()) {
    if (!bucket.has(entry.alias)) {
      bucket.set(entry.alias, { ...entry, matchKey: key })
    }
  }
  return bucket.values()
}

function similarity(a, b) {
  if (a === b) return 1
  const distance = levenshtein(a, b)
  const length = Math.max(a.length, b.length, 1)
  return 1 - distance / length
}

function levenshtein(a, b) {
  const aLen = a.length
  const bLen = b.length
  const dp = Array.from({ length: aLen + 1 }, () => new Array(bLen + 1).fill(0))
  for (let i = 0; i <= aLen; i += 1) dp[i][0] = i
  for (let j = 0; j <= bLen; j += 1) dp[0][j] = j
  for (let i = 1; i <= aLen; i += 1) {
    for (let j = 1; j <= bLen; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      )
    }
  }
  return dp[aLen][bLen]
}

async function buildTokenizerRegistry() {
  const [openaiMap, transformerMap, providerMap] = await Promise.all([
    loadOpenAIMap(),
    loadTransformersMap(),
    loadProviderManifest(),
  ])

  const openaiEntries = createOpenAIEntries(openaiMap)
  const transformerEntries = createTransformerEntries(transformerMap)
  const providerDefaults = deriveProviderDefaults(transformerEntries, providerMap)

  const registry = {
    openai: openaiEntries.map,
    transformers: transformerEntries.map,
    providerDefaults,
    defaultOpenAI: openaiEntries.defaultEntry,
  }

  return registry
}

function createOpenAIEntries(source) {
  const map = new Map()
  let defaultEntry
  const entries = Object.entries(source || {})
  for (const [alias, encoding] of entries) {
    const entry = {
      alias,
      spec: { kind: "tiktoken", model: encoding },
    }
    for (const key of buildAliasKeys(alias)) {
      if (!map.has(key)) map.set(key, entry)
    }
    if (!defaultEntry || alias === "gpt-4o") {
      defaultEntry = entry
    }
  }
  if (!defaultEntry && entries.length > 0) {
    const [alias, encoding] = entries[0]
    defaultEntry = { alias, spec: { kind: "tiktoken", model: encoding } }
  }
  return { map, defaultEntry }
}

function createTransformerEntries(source) {
  const map = new Map()
  for (const [alias, hub] of Object.entries(source || {})) {
    const entry = {
      alias,
      spec: { kind: "transformers", hub },
    }
    for (const key of buildAliasKeys(alias)) {
      if (!map.has(key)) map.set(key, entry)
    }
  }
  return { map }
}

function deriveProviderDefaults(transformerEntries, providerMap) {
  const defaults = new Map()
  for (const [provider, hub] of Object.entries(providerMap || {})) {
    defaults.set(provider, { kind: "transformers", hub })
  }

  const hints = [
    ["anthropic", ["claude"]],
    ["meta", ["llama"]],
    ["mistral", ["mistral", "codestral", "devstral"]],
    ["deepseek", ["deepseek"]],
    ["google", ["gemma", "palm", "gemini"]],
  ]

  const entries = Array.from(new Map(transformerEntries.map).values())
  for (const [provider, patterns] of hints) {
    if (defaults.has(provider)) continue
    const match = entries.find((entry) =>
      patterns.some((pattern) => entry.alias.includes(pattern) || entry.spec.hub.toLowerCase().includes(pattern)),
    )
    if (match) {
      defaults.set(provider, match.spec)
    }
  }

  return defaults
}

function buildAliasKeys(alias) {
  const keys = new Set()
  const normalized = normalizeModelKey(alias)
  if (normalized) keys.add(normalized)
  if (normalized?.includes(":")) {
    keys.add(normalized.split(":")[0])
  }
  if (normalized?.endsWith("-latest")) {
    keys.add(normalized.slice(0, -7))
  }
  return keys
}

async function loadOpenAIMap() {
  const candidates = [
    path.join(vendorRoot, "js-tiktoken", "model_to_encoding.json"),
    path.join(vendorRoot, "js-tiktoken", "dist", "model_to_encoding.json"),
  ]
  const data = await readFirstExistingJSON(candidates)
  if (data) return data
  return BUILTIN_OPENAI_FALLBACK
}

async function loadTransformersMap() {
  const candidates = [
    path.join(vendorRoot, "@huggingface", "transformers", "tokenizers.json"),
    path.join(vendorRoot, "@huggingface", "transformers", "tokenizers", "tokenizers.json"),
    path.join(vendorRoot, "@huggingface", "transformers", "pretrained-tokenizers.json"),
  ]
  const data = await readFirstExistingJSON(candidates)
  if (data) return normalizeTransformersManifest(data)
  return loadTransformersFallback()
}

async function loadProviderManifest() {
  const manifestPath = path.join(moduleRoot, "tokenizer-aliases.json")
  try {
    const raw = await fs.readFile(manifestPath, "utf8")
    const parsed = JSON.parse(raw)
    return parsed.providers || {}
  } catch {
    return {}
  }
}

async function readFirstExistingJSON(candidates) {
  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, "utf8")
      return JSON.parse(raw)
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error
      }
    }
  }
  return undefined
}

function normalizeTransformersManifest(data) {
  if (Array.isArray(data)) {
    const normalized = {}
    for (const item of data) {
      if (item && typeof item === "object" && item.alias && item.hub) {
        normalized[item.alias] = item.hub
      }
    }
    return normalized
  }
  if (data && typeof data === "object") {
    return data
  }
  return {}
}

function normalizeModelKey(value) {
  if (!value) return undefined
  return value.toLowerCase().replace(/[\s_]+/g, "-").trim()
}

function normalizeProviderKey(value) {
  if (!value) return undefined
  return value.toLowerCase().trim()
}

const BUILTIN_OPENAI_FALLBACK = {
  "gpt-5": "gpt-4o",
  "o4-mini": "gpt-4o",
  "o3": "gpt-4o",
  "o3-mini": "gpt-4o",
  "o1": "gpt-4o",
  "o1-pro": "gpt-4o",
  "gpt-4.1": "gpt-4o",
  "gpt-4.1-mini": "gpt-4o",
  "gpt-4o": "gpt-4o",
  "gpt-4o-mini": "gpt-4o-mini",
  "gpt-4-turbo": "gpt-4",
  "gpt-4": "gpt-4",
  "gpt-3.5-turbo": "gpt-3.5-turbo",
  "text-embedding-3-large": "text-embedding-3-large",
  "text-embedding-3-small": "text-embedding-3-small",
  "text-embedding-ada-002": "text-embedding-ada-002",
}

async function loadTransformersFallback() {
  try {
    const manifestPath = path.join(moduleRoot, "tokenizer-aliases.json")
    const raw = await fs.readFile(manifestPath, "utf8")
    const data = JSON.parse(raw)
    return data.transformers || {}
  } catch {
    return {}
  }
}
