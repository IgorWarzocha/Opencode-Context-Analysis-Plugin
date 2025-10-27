import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import path from "path"
import fs from "fs/promises"
import { fileURLToPath, pathToFileURL } from "url"
import { z } from "zod/v4"
import type { TokenModel } from "./tokenizer-registry.mjs"
import { resolveTokenModel, TokenizerResolutionError } from "./tokenizer-registry.mjs"

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
  tokens?: any
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

const tiktokenCache = new Map<string, any>()
const transformerCache = new Map<string, any>()
let tiktokenModule: Promise<any> | undefined
let transformersModule: Promise<any> | undefined

export const ContextUsagePlugin: Plugin = async ({ client }) => {
  return {
    tool: {
      context_usage: tool({
        description:
          "Get detailed token usage analysis for the current session. When this tool is called, analyze the results and provide a concise summary rather than reproducing the visual output.",
        args: {
          sessionID: tool.schema.string().optional(),
          limitMessages: tool.schema.number().int().min(1).max(10).optional(),
        },
        async execute(args, context) {
          const sessionID = args.sessionID ?? context.sessionID
          if (!sessionID) throw new Error("No session ID available for context summary")

          const response = await client.session.messages({ path: { id: sessionID } })
          const messages: SessionMessage[] = ((response as any)?.data ?? response ?? []) as SessionMessage[]

          if (!Array.isArray(messages) || messages.length === 0) {
            return `Session ${sessionID} has no messages yet.`
          }

          let tokenModel: TokenModel
          try {
            tokenModel = await resolveTokenModel(messages)
          } catch (error) {
            if (error instanceof TokenizerResolutionError) {
              return formatTokenizerResolutionError(error, sessionID)
            }
            throw error
          }
          const summary = await buildContextSummary({
            sessionID,
            messages,
            tokenModel,
            entryLimit: args.limitMessages ?? ENTRY_LIMIT,
          })

          return formatSummary(summary)
        },
      }),
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
    label: identifySystemPrompt(content, index + 1),
    content,
  }))
}

function identifySystemPrompt(content: string, index: number): string {
  const lower = content.toLowerCase()

  // More specific identification with length/content patterns
  if (lower.includes("opencode") && lower.includes("cli") && content.length > 500) {
    return "System#MainPrompt"
  }
  if (lower.includes("opencode") && lower.includes("cli") && content.length <= 500) {
    return "System#ShortPrompt"
  }
  if (lower.includes("agent") && lower.includes("mode")) {
    return "System#AgentMode"
  }
  if (lower.includes("permission") || lower.includes("allowed") || lower.includes("deny")) {
    return "System#Permissions"
  }
  if (lower.includes("tool") && (lower.includes("rule") || lower.includes("guideline"))) {
    return "System#ToolRules"
  }
  if (lower.includes("format") || lower.includes("style") || lower.includes("concise")) {
    return "System#Formatting"
  }
  if (lower.includes("project") || lower.includes("repository") || lower.includes("codebase")) {
    return "System#ProjectContext"
  }
  if (lower.includes("session") || lower.includes("context") || lower.includes("memory")) {
    return "System#SessionMgmt"
  }

  // Check for file references
  if (content.includes("@") && (content.includes(".md") || content.includes(".txt"))) {
    return "System#FileRefs"
  }

  // Check for agent definitions
  if (content.includes("name:") && content.includes("description:")) {
    return "System#AgentDef"
  }

  // Check for coding guidelines
  if (lower.includes("code") && (lower.includes("convention") || lower.includes("standard"))) {
    return "System#CodeGuidelines"
  }

  // Distinguish by content length and patterns for similar prompts
  if (lower.includes("opencode")) {
    if (content.includes("```") || content.includes("examples")) {
      return "System#MainWithExamples"
    }
    if (index === 1) return "System#Main-A"
    if (index === 2) return "System#Main-B"
    return `System#Main-${index}`
  }

  // Fallback to numbered
  return `System#${index}`
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
  const toolOutputs = new Map<string, string>()

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool") continue
      const state = (part as any).state
      if (state?.status !== "completed") continue
      const output = (state?.output ?? "").toString().trim()
      if (!output) continue
      const toolName = (part as any).tool || "tool"

      // Accumulate all outputs for each tool
      const existing = toolOutputs.get(toolName) || ""
      toolOutputs.set(toolName, existing + (existing ? "\n\n" : "") + output)
    }
  }

  return Array.from(toolOutputs.entries()).map(([toolName, content]) => ({
    label: toolName,
    content,
  }))
}

function collectReasoningTexts(messages: SessionMessage[]): CategoryEntrySource[] {
  const results: CategoryEntrySource[] = []
  let index = 0
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "reasoning") continue
      const text = ((part as any).text ?? "").toString().trim()
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
    .filter((m) => m.info.role === "assistant" && m.info?.tokens)
    .map((m) => ({
      msg: m,
      t: m.info.tokens as any,
    }))

  const pick =
    assistants
      .reverse()
      .find(
        ({ t }) =>
          (Number(t.input) || 0) +
            (Number(t.output) || 0) +
            (Number(t.reasoning) || 0) +
            (Number(t.cache?.read) || 0) +
            (Number(t.cache?.write) || 0) >
          0,
      ) ?? assistants[assistants.length - 1]

  if (!pick) return

  const tokens: any = pick.t

  const promptTokens =
    (Number(tokens.input) || 0) + (Number(tokens.cache?.read) || 0) + (Number(tokens.cache?.write) || 0)
  const assistantTokens = Number(tokens.output) || 0
  const reasoningTokens = Number(tokens.reasoning) || 0

  const promptMeasured =
    summary.categories.system.totalTokens + summary.categories.user.totalTokens + summary.categories.tools.totalTokens
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
    categories[0].totalTokens += Math.round(diff)
    if (categories[0].entries.length) categories[0].entries[0].tokens += Math.round(diff)
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
    category.entries[0].tokens += Math.round(diff)
    category.totalTokens += Math.round(diff)
  }
}

function scaleEntries(entries: CategoryEntry[], factor: number) {
  let total = 0
  for (const entry of entries) {
    entry.tokens = Math.round(entry.tokens * factor)
    total += entry.tokens
  }
  return total
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
  const categories = [
    { label: "SYSTEM", tokens: summary.categories.system.totalTokens },
    { label: "USER", tokens: summary.categories.user.totalTokens },
    { label: "ASSISTANT", tokens: summary.categories.assistant.totalTokens },
    { label: "TOOLS", tokens: summary.categories.tools.totalTokens },
    { label: "REASONING", tokens: summary.categories.reasoning.totalTokens },
  ]

  const topEntries = collectTopEntries(summary, 10)

  return formatVisualSummary(summary.sessionID, summary.model.name, summary.totalTokens, categories, topEntries)
}

function formatVisualSummary(
  sessionID: string,
  modelName: string,
  totalTokens: number,
  categories: Array<{ label: string; tokens: number }>,
  topEntries: CategoryEntry[],
): string {
  const lines: string[] = []

  // Header
  lines.push(`Context Analysis: Session ${sessionID}`)
  lines.push(``)

  // Bar chart
  const maxTokens = Math.max(...categories.map((c) => c.tokens), 1)
  for (const category of categories) {
    if (category.tokens === 0) continue
    const percentage = ((category.tokens / totalTokens) * 100).toFixed(1)
    const barWidth = Math.round((category.tokens / maxTokens) * 30)
    const bar = "█".repeat(barWidth) + "░".repeat(Math.max(0, 30 - barWidth))
    const label = category.label.padEnd(9)
    const tokens = formatNumber(category.tokens).padStart(6)
    const pct = percentage.padStart(5)
    lines.push(`${label} ${bar} ${pct}% (${tokens})`)
  }

  lines.push(``)

  // Total
  lines.push(`Total: ${formatNumber(totalTokens)} tokens`)

  if (topEntries.length > 0) {
    lines.push(``)
    lines.push(`Top Contributors:`)

    for (const entry of topEntries) {
      const percentage = ((entry.tokens / totalTokens) * 100).toFixed(1)
      const label = `• ${entry.label}`.padEnd(16)
      const tokens = `${formatNumber(entry.tokens)} tokens (${percentage}%)`
      lines.push(`${label} ${tokens}`)
    }
  }

  return lines.join("\n")
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

function formatTokenizerResolutionError(error: TokenizerResolutionError, sessionID: string): string {
  const lines = [
    `Unable to resolve a tokenizer for session ${sessionID}.`,
    error.message,
  ]

  if (error.models.length > 0) {
    lines.push(`Models considered: ${error.models.join(", ")}`)
  }
  if (error.providers.length > 0) {
    lines.push(`Providers observed: ${error.providers.join(", ")}`)
  }

  lines.push(
    "Install or update vendor tokenizers by running ./install.sh (optionally with a target directory).",
  )

  return lines.filter(Boolean).join("\n")
}

function capitalize(value: string): string {
  if (!value) return value
  return value[0].toUpperCase() + value.slice(1)
}
