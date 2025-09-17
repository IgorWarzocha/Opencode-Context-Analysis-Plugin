import type { Plugin } from "@opencode-ai/plugin"
import path from "path"
import fs from "fs/promises"
import { fileURLToPath, pathToFileURL } from "url"

const ENTRY_LIMIT = 3
const vendorRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "vendor", "node_modules")

interface SessionMessage {
  info: SessionMessageInfo
  parts: SessionMessagePart[]
}

interface SessionMessageInfo {
  id: string
  role: string
  modelID?: string
  providerID?: string
  system?: string[]
}

type SessionMessagePart =
  | {
      type: "text"
      text: string
      synthetic?: boolean
    }
  | {
      type: "reasoning"
      text: string
    }
  | {
      type: "tool"
      tool: string
      state: {
        status: "pending" | "running" | "completed" | "error"
        output?: string
      }
    }
  | { type: string; [key: string]: unknown }

type CategoryEntry = {
  label: string
  tokens: number
}

type CategorySummary = {
  label: string
  totalTokens: number
  entries: CategoryEntry[]
}

type TokenizerSpec =
  | { kind: "tiktoken"; model: string }
  | { kind: "transformers"; hub: string }
  | { kind: "approx" }

interface TokenModel {
  name: string
  spec: TokenizerSpec
}

interface ContextSummary {
  sessionID: string
  model: TokenModel
  categories: {
    system: CategorySummary
    user: CategorySummary
    assistant: CategorySummary
    tools: CategorySummary
    reasoning: CategorySummary
  }
  totalTokens: number
}

const openaiMap: Record<string, string> = {
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

const transformersMap: Record<string, string> = {
  "claude-opus-4": "Xenova/claude-tokenizer",
  "claude-sonnet-4": "Xenova/claude-tokenizer",
  "claude-3.7-sonnet": "Xenova/claude-tokenizer",
  "claude-3.5-sonnet": "Xenova/claude-tokenizer",
  "claude-3.5-haiku": "Xenova/claude-tokenizer",
  "claude-3-opus": "Xenova/claude-tokenizer",
  "claude-3-sonnet": "Xenova/claude-tokenizer",
  "claude-3-haiku": "Xenova/claude-tokenizer",
  "claude-2.1": "Xenova/claude-tokenizer",
  "claude-2.0": "Xenova/claude-tokenizer",
  "claude-instant-1.2": "Xenova/claude-tokenizer",
  "llama-4": "Xenova/llama4-tokenizer",
  "llama-3.3": "unsloth/Llama-3.3-70B-Instruct",
  "llama-3.2": "Xenova/Llama-3.2-Tokenizer",
  "llama-3.1": "Xenova/Meta-Llama-3.1-Tokenizer",
  "llama-3": "Xenova/llama3-tokenizer-new",
  "llama-2": "Xenova/llama2-tokenizer",
  "code-llama": "Xenova/llama-code-tokenizer",
  "deepseek-r1": "deepseek-ai/DeepSeek-R1",
  "deepseek-v3": "deepseek-ai/DeepSeek-V3",
  "deepseek-v2": "deepseek-ai/DeepSeek-V2",
  "mistral-large": "Xenova/mistral-tokenizer-v3",
  "mistral-small": "Xenova/mistral-tokenizer-v3",
  "mistral-nemo": "Xenova/Mistral-Nemo-Instruct-Tokenizer",
  "devstral-small": "Xenova/Mistral-Nemo-Instruct-Tokenizer",
  "codestral": "Xenova/mistral-tokenizer-v3",
}

const providerDefaults: Record<string, TokenizerSpec> = {
  anthropic: { kind: "transformers", hub: "Xenova/claude-tokenizer" },
  meta: { kind: "transformers", hub: "Xenova/Meta-Llama-3.1-Tokenizer" },
  mistral: { kind: "transformers", hub: "Xenova/mistral-tokenizer-v3" },
  deepseek: { kind: "transformers", hub: "deepseek-ai/DeepSeek-V3" },
  google: { kind: "transformers", hub: "google/gemma-2-9b-it" },
}

const tiktokenCache = new Map<string, any>()
const transformerCache = new Map<string, any>()
let tiktokenModule: Promise<any> | undefined
let transformersModule: Promise<any> | undefined

export const ContextUsagePlugin: Plugin = async ({ Tool, z, client }) => {
  const ContextUsage = Tool.define("context_usage", {
    description: "Summarize token usage for the current session",
    parameters: z
      .object({
        sessionID: z.string().optional(),
        limitMessages: z.number().int().min(1).max(10).optional(),
      })
      .default({}),
    async execute(args, ctx) {
      const sessionID = args.sessionID ?? ctx.sessionID
      if (!sessionID) throw new Error("No session ID available for context summary")

      const response = await client.session.messages({ path: { id: sessionID } })
      const messages: SessionMessage[] = ((response as any)?.data ?? response ?? []) as SessionMessage[]

      if (!Array.isArray(messages) || messages.length === 0) {
        return {
          title: `Context usage for ${sessionID}`,
          output: `Session ${sessionID} has no messages yet.`,
        }
      }

      const tokenModel = resolveTokenModel(messages)
      const summary = await buildContextSummary({
        sessionID,
        messages,
        tokenModel,
        entryLimit: args.limitMessages ?? ENTRY_LIMIT,
      })

      return {
        title: `Context usage for ${sessionID}`,
        output: formatSummary(summary),
        metadata: {
          sessionID,
          model: summary.model.name,
          totals: {
            system: summary.categories.system.totalTokens,
            user: summary.categories.user.totalTokens,
            assistant: summary.categories.assistant.totalTokens,
            tools: summary.categories.tools.totalTokens,
            reasoning: summary.categories.reasoning.totalTokens,
          },
          totalTokens: summary.totalTokens,
        },
      }
    },
  })

  return {
    async "tool.register"(_input, { register }) {
      register(ContextUsage)
    },
  }
}

async function buildContextSummary(input: {
  sessionID: string
  messages: SessionMessage[]
  tokenModel: TokenModel
  entryLimit: number
}): Promise<ContextSummary> {
  const { sessionID, messages, tokenModel, entryLimit } = input

  const systemPrompts = collectSystemPrompts(messages)
  const userTexts = collectMessageTexts(messages, "user")
  const assistantTexts = collectMessageTexts(messages, "assistant")
  const toolOutputs = collectToolOutputs(messages)
  const reasoningTraces = collectReasoningTexts(messages)

  const [system, user, assistant, tools, reasoning] = await Promise.all([
    buildCategory("system", systemPrompts, tokenModel, entryLimit),
    buildCategory("user", userTexts, tokenModel, entryLimit),
    buildCategory("assistant", assistantTexts, tokenModel, entryLimit),
    buildCategory("tools", toolOutputs, tokenModel, entryLimit),
    buildCategory("reasoning", reasoningTraces, tokenModel, entryLimit),
  ])

  const summary: ContextSummary = {
    sessionID,
    model: tokenModel,
    categories: { system, user, assistant, tools, reasoning },
    totalTokens:
      system.totalTokens + user.totalTokens + assistant.totalTokens + tools.totalTokens + reasoning.totalTokens,
  }

  applyTokenTelemetry(summary, messages)

  return summary
}

async function buildCategory(
  label: string,
  texts: CategoryEntrySource[],
  model: TokenModel,
  entryLimit: number,
): Promise<CategorySummary> {
  const results: CategoryEntry[] = []
  for (const item of texts) {
    const tokens = await countTokens(item.content, model)
    if (tokens > 0) results.push({ label: item.label, tokens })
  }
  results.sort((a, b) => b.tokens - a.tokens)
  const limited = results.slice(0, entryLimit)
  const totalTokens = results.reduce((sum, entry) => sum + entry.tokens, 0)
  return {
    label,
    totalTokens,
    entries: limited,
  }
}

type CategoryEntrySource = {
  label: string
  content: string
}

function collectSystemPrompts(messages: SessionMessage[]): CategoryEntrySource[] {
  const prompts = new Map<string, string>()
  for (const message of messages) {
    if (message.info.role !== "assistant") continue
    for (const prompt of message.info.system ?? []) {
      const trimmed = (prompt ?? "").trim()
      if (!trimmed) continue
      prompts.set(trimmed, trimmed)
    }
  }
  return Array.from(prompts.values()).map((content, index) => ({
    label: `System#${index + 1}`,
    content,
  }))
}

function collectMessageTexts(messages: SessionMessage[], role: "user" | "assistant"): CategoryEntrySource[] {
  const results: CategoryEntrySource[] = []
  let index = 0
  for (const message of messages) {
    if (message.info.role !== role) continue
    const content = extractText(message.parts)
    if (!content) continue
    index += 1
    results.push({ label: `${capitalize(role)}#${index}`, content })
  }
  return results
}

function collectToolOutputs(messages: SessionMessage[]): CategoryEntrySource[] {
  const results: CategoryEntrySource[] = []
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool") continue
      if (part.state.status !== "completed") continue
      const output = (part.state.output ?? "").toString().trim()
      if (!output) continue
      results.push({ label: `${part.tool || "tool"}`, content: output })
    }
  }
  return results
}

function collectReasoningTexts(messages: SessionMessage[]): CategoryEntrySource[] {
  const results: CategoryEntrySource[] = []
  let index = 0
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "reasoning") continue
      const text = (part.text ?? "").trim()
      if (!text) continue
      index += 1
      results.push({ label: `Reasoning#${index}`, content: text })
    }
  }
  return results
}

function extractText(parts: SessionMessagePart[]): string {
  return parts
    .filter((part): part is { type: "text"; text: string; synthetic?: boolean } => part.type === "text")
    .map((part) => part.text ?? "")
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n\n")
}

function applyTokenTelemetry(summary: ContextSummary, messages: SessionMessage[]) {
  // Prefer the most recent assistant message with non-zero usage.
  const assistants = [...messages]
    .filter((m) => m.info.role === "assistant" && (m as any).info?.tokens)
    .map((m) => ({
      msg: m,
      t: (m as any).info.tokens as any,
    }))

  const pick = assistants
    .reverse()
    .find(({ t }) =>
      ((Number(t.input) || 0) + (Number(t.output) || 0) + (Number(t.reasoning) || 0) +
        (Number(t.cache?.read) || 0) + (Number(t.cache?.write) || 0)) > 0,
    )
    ?? assistants.at(-1)

  if (!pick) return

  const tokens: any = pick.t

  const promptTokens =
    (Number(tokens.input) || 0) +
    (Number(tokens.cache?.read) || 0) +
    (Number(tokens.cache?.write) || 0)
  const assistantTokens = Number(tokens.output) || 0
  const reasoningTokens = Number(tokens.reasoning) || 0

  const promptMeasured =
    summary.categories.system.totalTokens +
    summary.categories.user.totalTokens +
    summary.categories.tools.totalTokens
  scalePromptCategories(summary, promptTokens, promptMeasured)

  scaleCategory(summary.categories.assistant, assistantTokens, "Assistant output")
  scaleCategory(summary.categories.reasoning, reasoningTokens, "Reasoning")

  summary.totalTokens =
    summary.categories.system.totalTokens +
    summary.categories.user.totalTokens +
    summary.categories.assistant.totalTokens +
    summary.categories.tools.totalTokens +
    summary.categories.reasoning.totalTokens
}

function scalePromptCategories(summary: ContextSummary, actual: number, measured: number) {
  const categories = [summary.categories.system, summary.categories.user, summary.categories.tools]
  if (actual <= 0) {
    for (const category of categories) {
      category.totalTokens = 0
      for (const entry of category.entries) entry.tokens = 0
    }
    return
  }

  if (measured <= 0) {
    const share = actual / categories.length
    for (const category of categories) {
      if (category.entries.length === 0) {
        category.entries.push({ label: category.label, tokens: share })
      } else {
        category.entries = [{ label: category.entries[0].label, tokens: share }]
      }
      category.totalTokens = share
    }
    return
  }

  const factor = actual / measured
  let accumulated = 0
  for (const category of categories) {
    const scaled = scaleEntries(category.entries, factor)
    category.totalTokens = scaled
    accumulated += scaled
  }
  const diff = actual - accumulated
  if (Math.abs(diff) > 1e-6 && categories.length) {
    categories[0].totalTokens += diff
    if (categories[0].entries.length) categories[0].entries[0].tokens += diff
  }
}

function scaleCategory(category: CategorySummary, actual: number, fallbackLabel: string) {
  if (actual <= 0) {
    category.totalTokens = 0
    category.entries = []
    return
  }
  const measured = category.totalTokens
  if (measured <= 0) {
    category.entries = [{ label: fallbackLabel, tokens: actual }]
    category.totalTokens = actual
    return
  }
  const factor = actual / measured
  const scaled = scaleEntries(category.entries, factor)
  category.totalTokens = scaled
  const diff = actual - scaled
  if (Math.abs(diff) > 1e-6 && category.entries.length) {
    category.entries[0].tokens += diff
    category.totalTokens += diff
  }
}

function scaleEntries(entries: CategoryEntry[], factor: number) {
  let total = 0
  for (const entry of entries) {
    entry.tokens *= factor
    total += entry.tokens
  }
  return total
}

function resolveTokenModel(messages: SessionMessage[]): TokenModel {
  for (const message of [...messages].reverse()) {
    const id = canonical(message.info.modelID)
    const provider = canonical(message.info.providerID)

    const openaiMatch = resolveOpenAIModel(id, provider)
    if (openaiMatch) return openaiMatch

    const transformerMatch = resolveTransformersModel(id, provider)
    if (transformerMatch) return transformerMatch
  }

  return {
    name: "approx",
    spec: { kind: "approx" },
  }
}

function resolveOpenAIModel(modelID?: string, providerID?: string): TokenModel | undefined {
  if (providerID === "openai" || providerID === "opencode" || providerID === "azure") {
    const mapped = mapOpenAI(modelID)
    return { name: modelID ?? mapped, spec: { kind: "tiktoken", model: mapped } }
  }
  if (modelID && openaiMap[modelID]) {
    return { name: modelID, spec: { kind: "tiktoken", model: openaiMap[modelID] } }
  }
  return undefined
}

function resolveTransformersModel(modelID?: string, providerID?: string): TokenModel | undefined {
  if (modelID && transformersMap[modelID]) {
    return { name: modelID, spec: { kind: "transformers", hub: transformersMap[modelID] } }
  }
  if (providerID && providerDefaults[providerID]) {
    return { name: modelID ?? providerID, spec: providerDefaults[providerID] }
  }
  if (modelID?.startsWith("claude")) {
    return { name: modelID, spec: { kind: "transformers", hub: "Xenova/claude-tokenizer" } }
  }
  if (modelID?.startsWith("llama")) {
    return { name: modelID, spec: { kind: "transformers", hub: transformersMap[modelID] ?? "Xenova/Meta-Llama-3.1-Tokenizer" } }
  }
  if (modelID?.startsWith("mistral")) {
    return { name: modelID, spec: { kind: "transformers", hub: "Xenova/mistral-tokenizer-v3" } }
  }
  if (modelID?.startsWith("deepseek")) {
    return { name: modelID, spec: { kind: "transformers", hub: "deepseek-ai/DeepSeek-V3" } }
  }
  return undefined
}

function mapOpenAI(modelID?: string): string {
  if (!modelID) return "cl100k_base"
  return openaiMap[modelID] ?? modelID
}

async function countTokens(content: string, model: TokenModel): Promise<number> {
  if (!content.trim()) return 0
  if (model.spec.kind === "approx") {
    return Math.ceil(content.length / 4)
  }
  if (model.spec.kind === "tiktoken") {
    const encoder = await loadTiktokenEncoder(model.spec.model)
    try {
      return encoder.encode(content).length
    } catch {
      return Math.ceil(content.length / 4)
    }
  }
  if (model.spec.kind === "transformers") {
    const tokenizer = await loadTransformersTokenizer(model.spec.hub)
    if (!tokenizer || typeof tokenizer.encode !== "function") {
      return Math.ceil(content.length / 4)
    }
    try {
      const encoding = await tokenizer.encode(content)
      return Array.isArray(encoding) ? encoding.length : (encoding?.length ?? Math.ceil(content.length / 4))
    } catch {
      return Math.ceil(content.length / 4)
    }
  }
  return Math.ceil(content.length / 4)
}

async function loadTiktokenEncoder(model: string) {
  if (tiktokenCache.has(model)) return tiktokenCache.get(model)
  const mod = await loadTiktokenModule()
  const { encoding_for_model, get_encoding } = mod
  let encoder
  try {
    encoder = encoding_for_model(model)
  } catch {
    encoder = get_encoding("cl100k_base")
  }
  tiktokenCache.set(model, encoder)
  return encoder
}

async function loadTiktokenModule() {
  if (!tiktokenModule) {
    tiktokenModule = importFromVendor("js-tiktoken")
  }
  return tiktokenModule
}

async function loadTransformersTokenizer(hub: string) {
  if (transformerCache.has(hub)) return transformerCache.get(hub)
  try {
    const { AutoTokenizer } = await loadTransformersModule()
    const tokenizer = await AutoTokenizer.from_pretrained(hub)
    transformerCache.set(hub, tokenizer)
    return tokenizer
  } catch {
    transformerCache.set(hub, null)
    return null
  }
}

async function loadTransformersModule() {
  if (!transformersModule) {
    transformersModule = importFromVendor("@huggingface/transformers")
  }
  return transformersModule
}

async function importFromVendor(pkg: string) {
  const pkgJsonPath = path.join(vendorRoot, pkg, "package.json")
  let data: string
  try {
    data = await fs.readFile(pkgJsonPath, "utf8")
  } catch {
    throw new Error(
      "Context usage dependencies missing. Run ./context-command/install.sh (or the install script packaged with /context) to install vendor tokenizers.",
    )
  }
  const manifest = JSON.parse(data)
  const entry = manifest.module ?? manifest.main ?? "index.js"
  const entryPath = path.join(vendorRoot, pkg, entry)
  return import(pathToFileURL(entryPath).href)
}

function formatSummary(summary: ContextSummary): string {
  const sys = summary.categories.system.totalTokens
  const user = summary.categories.user.totalTokens
  const assistant = summary.categories.assistant.totalTokens
  const tools = summary.categories.tools.totalTokens
  const reasoning = summary.categories.reasoning.totalTokens

  const firstLine = `Session ${summary.sessionID} · model ${summary.model.name} · total ${formatNumber(summary.totalTokens)} tokens`
  const secondLine = `Breakdown — system ${formatNumber(sys)} | user ${formatNumber(user)} | assistant ${formatNumber(assistant)} | tools ${formatNumber(tools)} | reasoning ${formatNumber(reasoning)}`

  const topEntries = collectTopEntries(summary, 3)
  const thirdLine = topEntries.length
    ? `Top contributors: ${topEntries.map((item) => `${item.label} ${formatNumber(item.tokens)}`).join(", ")}`
    : undefined

  return [firstLine, secondLine, thirdLine].filter(Boolean).join("\n")
}

function collectTopEntries(summary: ContextSummary, limit: number): CategoryEntry[] {
  const pool = [
    ...summary.categories.system.entries,
    ...summary.categories.user.entries,
    ...summary.categories.assistant.entries,
    ...summary.categories.tools.entries,
    ...summary.categories.reasoning.entries,
  ]
    .filter((entry) => entry.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
  return pool.slice(0, limit)
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value)
}

function canonical(value?: string): string | undefined {
  return value?.split("/").pop()?.toLowerCase().trim()
}

function capitalize(value: string): string {
  if (!value) return value
  return value[0].toUpperCase() + value.slice(1)
}

type CategoryEntrySource = {
  label: string
  content: string
}
