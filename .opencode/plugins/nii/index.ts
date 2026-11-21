/**
 * NII — Nothing Is Impossible
 *
 * Motivation layer + bounded stuckness recovery + persistent strategy learning.
 *
 *  - Injects an adaptive "nothing is impossible" mandate into every agent-loop
 *    model call. Intensity rises with evidence of stuckness, then deliberately
 *    falls away once the pivot budget is spent.
 *  - Registers an auto-invoked playbook skill.
 *  - Tracks tool failures per session (shell non-zero exits included) and
 *    nudges on repeated outcomes; offers deeper escalations.
 *  - On a threshold, asks a small "coach" generation for a genuinely different
 *    approach and injects it as a synthetic message. Budget: MAX_PIVOTS.
 *  - When a pivot succeeds, the strategy is learned globally and reused as a
 *    coach hint; when it fails, it is marked ineffective for those failures.
 *  - Provides /nii as a kill switch, introspection, and reset.
 *
 * Every persistence mechanism is bounded: a threshold, a cap, a verifiable
 * success condition, and a genuine-blocker stop rule.
 */

import { Plugin, Skill } from "@opencode/plugin"
import { resolveGenerateText } from "./api"
import { withLock } from "./lock"
import { parseNiiCommand } from "./commands"
import {
  fallbackProposal,
  HELP_TEXT,
  motivationFor,
  pivotMessage,
  SKILL_PLAYBOOK,
  statusText,
} from "./playbook"
import {
  isDistinctEnough,
  ineffectiveStrategies,
  matchingStrategies,
  recordIneffective,
  recordLearning,
} from "./learning"
import {
  clearPending,
  clearSessionOverride,
  clearStuck,
  isEnabled,
  readLearning,
  readPending,
  readStuck,
  setSessionEnabled,
  writeLearning,
  writePending,
  writeStuck,
} from "./state"
import { niiRetryDecision } from "./retry"
import {
  buildCoachPrompt,
  claimPivot,
  detectQuitSignals,
  failureCount,
  finalizePivot,
  isExhausted,
  isGenuineBlocker,
  isSuccessClaim,
  isToolFailure,
  MAX_PIVOTS,
  recordBlocker,
  recordFailure,
  recordRefusal,
  recordSuccess,
  recordSuccessClaim,
  shouldPivot,
  toolFailureSignature,
  toolFailureText,
  type InflightPivot,
  type ToolOutcome,
} from "./stuck"

export default Plugin.define({
  id: "nii",

  async setup(ctx) {
    // 1. The full methodology, auto-invoked when the agent gets stuck.
    const skillPath = `${ctx.location.directory}/.opencode/plugins/nii/SKILL.md`
    await ctx.skill.transform((editor) => {
      editor.add({
        id: Skill.ID.make("nii"),
        name: Skill.Name.make("NII — Nothing Is Impossible"),
        description:
          "Use when a task seems impossible, after repeated failures, or before giving up. Reframe, switch approach, and verify success with evidence.",
        path: Skill.Info.fields.path.make(skillPath),
        content: SKILL_PLAYBOOK,
      })
      editor.update("nii", (skill) => {
        skill.autoinvoke = true
      })
    })

    // 2. Failure tracking. Session tool events carry the sessionID; the server
    //    ignores `types` and delivers every event, so filter explicitly.
    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({
        types: ["session.tool.failed", "session.tool.success", "session.text.ended"],
        signal: controller.signal,
      })) {
        if (event.type === "session.text.ended") {
          const textData = event.data as { sessionID?: string; text?: string }
          if (!textData.sessionID || !(await isEnabled(ctx, textData.sessionID))) continue
          const text = textData.text ?? ""
          const quit = detectQuitSignals(text)
          const successClaim = isSuccessClaim(text)
          if (quit.length === 0 && !successClaim) continue

          const cur = await readStuck(ctx, textData.sessionID)
          let next = cur
          if (quit.length > 0) next = recordRefusal(next)
          if (successClaim) next = recordSuccessClaim(next)
          await writeStuck(ctx, textData.sessionID, next)
          continue
        }
        if (event.type !== "session.tool.failed" && event.type !== "session.tool.success") continue

        const data = event.data as ToolOutcome & { sessionID?: string }
        if (!data.sessionID) continue
        if (!(await isEnabled(ctx, data.sessionID))) continue

        const current = await readStuck(ctx, data.sessionID)

        if (isToolFailure(event.type, data)) {
          // A genuine blocker outranks the whole persistence loop: stop trying
          // to pivot and tell the agent to ask the user instead.
          const failureText = `${data.error?.type ?? ""} ${toolFailureText(data)}`
          if (isGenuineBlocker(failureText)) {
            await writeStuck(ctx, data.sessionID, recordBlocker(current))
            continue
          }

          const pending = await readPending(ctx, data.sessionID)
          // The previous pivot did not settle the problem; do not credit it,
          // and record it as ineffective so future coaches avoid it.
          if (pending) {
            const learned = await readLearning(ctx)
            await writeLearning(ctx, recordIneffective(learned, pending.signatures, pending.strategy))
            await clearPending(ctx, data.sessionID)
          }
          await writeStuck(ctx, data.sessionID, recordFailure(current, toolFailureSignature(data)))
          continue
        }

        // A success following a pivot is the only signal that the strategy
        // worked. Store it as a reusable hint for future sessions.
        const pending = await readPending(ctx, data.sessionID)
        if (pending) {
          const learned = await readLearning(ctx)
          await writeLearning(ctx, recordLearning(learned, pending.signatures, pending.strategy))
          await clearPending(ctx, data.sessionID)
        }
        await writeStuck(ctx, data.sessionID, recordSuccess(current))
      }
    })()

    // 3. The mandate, escalation, and pivot delivery. The context hook runs
    //    for the agent loop including tool continuations, so the mindset and
    //    the pivot directive survive every step.
    await ctx.session.hook("context", async (event) => {
      if (!(await isEnabled(ctx, event.sessionID))) return

      const stuck = await readStuck(ctx, event.sessionID)
      event.system.push({ type: "text", text: motivationFor(stuck, MAX_PIVOTS) })

      // Proactive hint: if strategies are already known to work for this
      // failure signature and no pivot has fired yet, offer them now.
      if (stuck.pivots === 0 && failureCount(stuck) >= 2 && !isExhausted(stuck)) {
        const learned = await readLearning(ctx)
        const known = matchingStrategies(learned, stuck.ruledOut)
        if (known.length > 0) {
          event.system.push({
            type: "text",
            text: `NII: strategies already known to work for this kind of failure:\n${known.map((item) => `- ${item}`).join("\n")}`,
          })
        }
      }

      if (isExhausted(stuck)) return

      if (stuck.inflight || shouldPivot(stuck)) {
        await withLock(`nii:pivot:${event.sessionID}`, async () => {
          const latest = await readStuck(ctx, event.sessionID)
          let inflight: InflightPivot | undefined = latest.inflight

          if (!inflight) {
            if (!shouldPivot(latest)) return
            let proposal: string
            try {
              const generateText = resolveGenerateText(ctx)
              if (!generateText) throw new Error("no one-shot generation API available")
              const configured = ctx.options?.coachModel as { providerID: string; id: string } | undefined
              const model = configured ?? (await ctx.model.default())
              if (!model) throw new Error("no default model available")

              const learned = await readLearning(ctx)
              const effective = matchingStrategies(learned, latest.ruledOut)
              const avoided = ineffectiveStrategies(learned, latest.ruledOut)
              proposal = (
                await generateText({
                  model: { providerID: model.providerID, id: model.id },
                  prompt: buildCoachPrompt(latest.ruledOut, effective, avoided),
                })
              ).text
              if (!isDistinctEnough(proposal, latest.pivotsTried)) {
                proposal = fallbackProposal(latest.ruledOut)
              }
            } catch (error) {
              proposal = fallbackProposal(latest.ruledOut)
              console.error("nii: coach generation failed, using deterministic pivot", error)
            }

            inflight = { proposal, signatures: latest.ruledOut }
            // Claim before delivery: no pivot budget is consumed yet, and a
            // crash here simply regenerates on the next call.
            await writeStuck(ctx, event.sessionID, claimPivot(latest, proposal, inflight.signatures))
          }

          try {
            const beforeDelivery = await readStuck(ctx, event.sessionID)
            await ctx.session.synthetic({
              sessionID: event.sessionID,
              text: pivotMessage(inflight.proposal, beforeDelivery.pivots + 1, MAX_PIVOTS),
            })
          } catch (error) {
            // Keep the claim. A resumed session will replay the same pivot
            // rather than silently spending the budget.
            console.error("nii: pivot delivery failed; will replay it on the next call", error)
            return
          }

          // Delivery succeeded — now, and only now, consume the budget.
          const delivered = await readStuck(ctx, event.sessionID)
          await writeStuck(ctx, event.sessionID, finalizePivot(delivered))
          await writePending(ctx, event.sessionID, {
            signatures: inflight.signatures,
            strategy: inflight.proposal,
          })
        })
      }
    })

    // 3b. Bounded provider-error retries. OpenCode's own policy and hard
    //     max-attempt limit still apply; we only extend transient failures.
    const retryOptions = {
      maxRetries:
        typeof ctx.options?.retryMaxRetries === "number" ? ctx.options.retryMaxRetries : undefined,
      baseDelayMs:
        typeof ctx.options?.retryBaseDelayMs === "number" ? ctx.options.retryBaseDelayMs : undefined,
      maxDelayMs:
        typeof ctx.options?.retryMaxDelayMs === "number" ? ctx.options.retryMaxDelayMs : undefined,
    }
    await ctx.session.hook("retry", async (event) => {
      if (!(await isEnabled(ctx, event.sessionID))) return
      const decision = niiRetryDecision(event.error, event.attempt, retryOptions)
      if (decision) event.decision = decision
    })

    // 4. Kill switch + introspection. Gating is checked inside the context
    //    hook, so disabling takes effect on the very next model call.
    await ctx.command.transform((editor) => {
      editor.add({
        name: "nii",
        description: "Nothing Is Impossible — enable, disable, or inspect the NII mandate",
        execute: async ({ sessionID, prompt }) => {
          switch (parseNiiCommand(prompt.text)) {
            case "on": {
              await clearSessionOverride(ctx, sessionID)
              await ctx.session.synthetic({ sessionID, text: "NII enabled for this session." })
              return
            }
            case "off": {
              await setSessionEnabled(ctx, sessionID, false)
              await ctx.session.synthetic({
                sessionID,
                text: "NII disabled for this session. Use /nii on to re-enable.",
              })
              return
            }
            case "reset": {
              await clearStuck(ctx, sessionID)
              await ctx.session.synthetic({
                sessionID,
                text: "NII reset for this session: failure streak and pivot budget cleared. Learning is kept.",
              })
              return
            }
            case "status": {
              const enabled = await isEnabled(ctx, sessionID)
              const stuck = await readStuck(ctx, sessionID)
              const learned = await readLearning(ctx)
              await ctx.session.synthetic({
                sessionID,
                text: statusText(enabled, "session", stuck.pivots, MAX_PIVOTS, learned.length, stuck.lastPivot),
              })
              return
            }
            case "help":
            default: {
              await ctx.session.synthetic({ sessionID, text: HELP_TEXT })
              return
            }
          }
        },
      })
    })

    return () => controller.abort()
  },
})
