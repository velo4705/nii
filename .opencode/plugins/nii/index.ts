/**
 * NII — Nothing Is Impossible
 *
 * V3: motivation layer + bounded stuckness recovery + persistent strategy learning.
 *
 *  - Injects a short, bounded mandate into every agent-loop model call.
 *  - Registers an auto-invoked playbook skill.
 *  - Tracks tool failures per session and escalates after a streak.
 *  - On a threshold, asks a small "coach" generation for a genuinely different
 *    approach and injects it as a synthetic message. Budget: MAX_PIVOTS.
 *  - Provides /nii as a kill switch and status command.
 *
 * Every persistence mechanism is bounded: a threshold, a cap, a verifiable
 * success condition, and a genuine-blocker stop rule.
 */

import { Plugin, Skill } from "@opencode/plugin"
import { resolveGenerateText } from "./api"
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
  ineffectiveStrategies,
  isDistinctEnough,
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
import {
  buildCoachPrompt,
  failureCount,
  isExhausted,
  isToolFailure,
  markPivoted,
  MAX_PIVOTS,
  recordFailure,
  recordSuccess,
  shouldPivot,
  toolFailureSignature,
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

    // 2. Failure tracking. Session tool events carry the sessionID and a
    //    structured error, so state is scoped correctly even with sessions
    //    running in parallel.
    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({
        types: ["session.tool.failed", "session.tool.success"],
        signal: controller.signal,
      })) {
        // The server ignores `types` here and delivers every event; filter
        // explicitly so tool start/progress events cannot reset a streak.
        if (event.type !== "session.tool.failed" && event.type !== "session.tool.success") continue

        const data = event.data as ToolOutcome & { sessionID?: string }
        if (!data.sessionID) continue
        if (!(await isEnabled(ctx, data.sessionID))) continue

        const current = await readStuck(ctx, data.sessionID)

        if (isToolFailure(event.type, data)) {
          // The previous pivot did not settle the problem; do not credit it.
          await clearPending(ctx, data.sessionID)
          await writeStuck(ctx, data.sessionID, recordFailure(current, toolFailureSignature(data)))
          continue
        }

        // A success following a pivot is the only signal that the proposed
        // strategy worked. Store it as a reusable hint for future sessions.
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
      event.system.push({ type: "text", text: BASE_MANDATE })

      const stuck = await readStuck(ctx, event.sessionID)

      if (isExhausted(stuck)) {
        event.system.push({ type: "text", text: EXHAUSTED_MANDATE })
        return
      }

      if (shouldPivot(stuck)) {
        // Mark before generating so concurrent calls do not spawn duplicate
        // coaches. Roll back if generation fails.
        await writeStuck(ctx, event.sessionID, markPivoted(stuck))
        try {
          const model = await ctx.model.default()
          if (!model) throw new Error("no default model available")
          const generateText = resolveGenerateText(ctx)
          if (!generateText) throw new Error("no one-shot generation API available")
          const learned = await readLearning(ctx)
          const coach = await generateText({
            model: { providerID: model.providerID, id: model.id },
            prompt: buildCoachPrompt(stuck.ruledOut, matchingStrategies(learned, stuck.ruledOut)),
          })
          await ctx.session.synthetic({
            sessionID: event.sessionID,
            text: pivotMessage(coach.text, stuck.pivots + 1, MAX_PIVOTS),
          })
          await writePending(ctx, event.sessionID, {
            signatures: stuck.ruledOut,
            strategy: coach.text,
          })
        } catch (error) {
          await writeStuck(ctx, event.sessionID, stuck)
          console.error("nii: coach generation failed", error)
        }
        return
      }

      if (stuck.streak >= 2) {
        event.system.push({ type: "text", text: STUCK_NUDGE })
      }
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
              await ctx.session.synthetic({
                sessionID,
                text: "NII enabled for this session.",
              })
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
            case "status": {
              const enabled = await isEnabled(ctx, sessionID)
              const stuck = await readStuck(ctx, sessionID)
              const learned = await readLearning(ctx)
              await ctx.session.synthetic({
                sessionID,
                text: statusText(enabled, "session", stuck.pivots, MAX_PIVOTS, learned.length),
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
