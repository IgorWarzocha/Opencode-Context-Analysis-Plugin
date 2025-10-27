import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

import {
  resolveTokenModel,
  resetTokenizerRegistryCache,
  TokenizerResolutionError,
} from "../.opencode/plugin/tokenizer-registry.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, "..")
const pluginRoot = path.join(projectRoot, ".opencode", "plugin")
const vendorRoot = path.join(pluginRoot, "vendor", "node_modules")

async function ensureFixtures() {
  await fs.rm(vendorRoot, { recursive: true, force: true })
  await fs.mkdir(path.join(vendorRoot, "js-tiktoken"), { recursive: true })
  await fs.writeFile(
    path.join(vendorRoot, "js-tiktoken", "model_to_encoding.json"),
    JSON.stringify(
      {
        "gpt-test": "custom-encoding",
        "gpt-4o": "gpt-4o",
      },
      null,
      2,
    ),
    "utf8",
  )

  await fs.mkdir(path.join(vendorRoot, "@huggingface", "transformers"), { recursive: true })
  await fs.writeFile(
    path.join(vendorRoot, "@huggingface", "transformers", "tokenizers.json"),
    JSON.stringify(
      {
        "claude-test": "Xenova/claude-mock",
        "llama-3.1": "Xenova/Meta-Llama-3.1-Tokenizer",
      },
      null,
      2,
    ),
    "utf8",
  )
}

beforeEach(async () => {
  resetTokenizerRegistryCache()
  await ensureFixtures()
})

test("resolves OpenAI models using vendored metadata", async () => {
  const model = await resolveTokenModel([
    {
      info: { role: "assistant", modelID: "gpt-test", providerID: "openai" },
      parts: [],
    },
  ])

  assert.equal(model.spec.kind, "tiktoken")
  assert.equal(model.spec.model, "custom-encoding")
})

test("derives provider defaults from transformers manifest", async () => {
  const model = await resolveTokenModel([
    {
      info: { role: "assistant", modelID: "claude-new", providerID: "anthropic" },
      parts: [],
    },
  ])

  assert.equal(model.spec.kind, "transformers")
  assert.ok(["Xenova/claude-mock", "Xenova/claude-tokenizer"].includes(model.spec.hub))
})

test("suggests closest tokenizer alias for similar model IDs", async () => {
  const model = await resolveTokenModel([
    {
      info: { role: "assistant", modelID: "claude-test-v2" },
      parts: [],
    },
  ])

  assert.equal(model.spec.kind, "transformers")
  assert.equal(model.spec.hub, "Xenova/claude-mock")
})

test("throws a descriptive error when no tokenizer is available", async () => {
  await assert.rejects(
    async () =>
      resolveTokenModel([
        {
          info: { role: "assistant", modelID: "unknown-model", providerID: "mystery" },
          parts: [],
        },
      ]),
    (error) => {
      assert(error instanceof TokenizerResolutionError)
      assert.equal(error.models.includes("unknown-model"), true)
      assert.equal(error.providers.includes("mystery"), true)
      return true
    },
  )
})
