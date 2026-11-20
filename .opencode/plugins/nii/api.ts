/**
 * Compatibility shim for the one-shot generation API.
 *
 * The V2 docs describe `ctx.experimental.generate.text`, but installed
 * OpenCode 2.0.32 exposes the same method at `ctx.generate.text`. Resolve
 * whichever exists so the coach works on both shapes.
 */

export type GenerateTextInput = {
  model: { providerID: string; id: string }
  prompt: string
}

export type GenerateText = (input: GenerateTextInput) => Promise<{ text: string }>

export function resolveGenerateText(ctx: unknown): GenerateText | undefined {
  const candidate = ctx as {
    experimental?: { generate?: { text?: GenerateText } }
    generate?: { text?: GenerateText }
  }

  const source = candidate.experimental?.generate ?? candidate.generate
  const fn = source?.text
  return fn ? fn.bind(source) : undefined
}
