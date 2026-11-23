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

import { execFileSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Plugin, Skill } from "@opencode/plugin"
import { resolveGenerateText } from "./api"
import {
  continuationDirective,
  detectCheats,
  emptyActivity,
  exitDecision,
  isTaskExecution,
  lightweightPass,
  recordCompletionTag,
  recordContinuation,
  recordExit,
  recordTool,
  shouldInjectMandate,
  wallExceeded,
  type Activity,
} from "./proof"
import { withLock } from "./lock"
import { parseNiiCommand } from "./commands"
import {
  fallbackProposal,
  HELP_TEXT,
  motivationFor,
  pivotMessage,
  quitResponse,
  SKILL_PLAYBOOK,
  statusText,
} from "./playbook"
import {
  isDistinctEnough,
  ineffectiveStrategies,
  recordIneffective,
  recordLearning,
  strategyHints,
} from "./learning"
import {
  buildValidationDirective,
  detectCaseCategories,
  mergeValidationRecords,
} from "./validation"
import {
  clearPending,
  clearSessionOverride,
  clearStuck,
  isEnabled,
  readLearning,
  readPending,
  projectScope,
  readStuck,
  setSessionEnabled,
  writeLearning,
  writePending,
  writeStuck,
} from "./state"
import { buildMemoryFile, ledgerText } from "./memory"
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

/** Per-session proof state. In-memory is enough; idle and tools are live events. */
const activities = new Map<string, Activity>()
const lastPrompts = new Map<string, string>()

export default Plugin.define({
  id: "nii",

  async setup(ctx) {
    const maxPivots =
      typeof ctx.options?.maxPivots === "number" ? ctx.options.maxPivots : MAX_PIVOTS

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

    async function syncMemory(sessionID: string) {
      const stuck = await readStuck(ctx, sessionID)
      const learned = await readLearning(ctx)
      const dir = join(ctx.location?.directory ?? process.cwd(), ".opencode")
      try {
        await mkdir(dir, { recursive: true })
        await writeFile(
          join(dir, "nii-memory.json"),
          `${JSON.stringify(buildMemoryFile(projectScope(ctx), stuck, learned), null, 2)}\n`,
          "utf8",
        )
      } catch {
        // Memory is a visibility aid; never break a session over a file write.
      }
    }

    async function applyProofGate(sessionID: string) {
      const activity = activities.get(sessionID) ?? emptyActivity()
      if (!isTaskExecution(activity) && !activity.blocker && !activity.userAbort) return

      let cheats: string[] = []
      try {
        const vcsApi = ctx as unknown as { vcs?: { diff(input?: unknown): Promise<unknown> } }
        if (vcsApi.vcs?.diff) {
          cheats = detectCheats(JSON.stringify(await vcsApi.vcs.diff({ mode: "working" })))
        }
      } catch {
        cheats = []
      }

      const verifyCmd = typeof ctx.options?.verifyCmd === "string" ? ctx.options.verifyCmd : undefined
      let verifiedPass = false
      if (verifyCmd) {
        try {
          execFileSync("sh", ["-c", verifyCmd], {
            cwd: ctx.location?.directory ?? process.cwd(),
            timeout: 120_000,
            stdio: "pipe",
          })
          verifiedPass = true
        } catch {
          verifiedPass = false
        }
      } else if (activity.lastExitCode !== undefined) {
        verifiedPass = activity.lastExitCode === 0
      } else if (ctx.options?.allowSubjectiveCompletion !== false) {
        verifiedPass = lightweightPass(activity, cheats)
      }

      const cap =
        typeof ctx.options?.maxContinuations === "number" ? ctx.options.maxContinuations : 0
      const budgetReached = cap > 0 && activity.continuations >= cap
      const maxWallMs =
        typeof ctx.options?.maxWallMs === "number" ? ctx.options.maxWallMs : 0
      const decision = exitDecision({
        activity,
        verifiedPass,
        cheats,
        budgetReached,
        wallExceeded: wallExceeded(activity, maxWallMs),
      })
      if (decision !== "continue") return

      activities.set(sessionID, recordContinuation(activity))
      const resumeDelayMs =
        typeof ctx.options?.resumeDelayMs === "number" ? ctx.options.resumeDelayMs : 0
      if (resumeDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, resumeDelayMs))
      }
      const sessionApi = ctx as unknown as {
        session?: { prompt(input: { sessionID: string; text: string }): Promise<unknown> }
      }
      if (!sessionApi.session?.prompt) return
      await sessionApi.session.prompt({
        sessionID,
        text: continuationDirective(cheats),
      })
    }

    // 2. Failure tracking. Session tool events carry the sessionID; the server
    //    ignores `types` and delivers every event, so filter explicitly.
    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({
        types: [
          "session.tool.called",
          "session.tool.failed",
          "session.tool.success",
          "session.text.ended",
          "session.idle",
          "session.execution.interrupted",
          "session.compaction.ended",
        ],
        signal: controller.signal,
      })) {
        if (event.type === "session.tool.called") {
          const call = event.data as { sessionID?: string; name?: string }
          if (!call.sessionID) continue
          const current = activities.get(call.sessionID) ?? emptyActivity()
          activities.set(call.sessionID, recordTool(current, call.name ?? ""))
          continue
        }

        if (event.type === "session.execution.interrupted") {
          const stopped = event.data as { sessionID?: string }
          if (!stopped.sessionID) continue
          const current = activities.get(stopped.sessionID) ?? emptyActivity()
          activities.set(stopped.sessionID, { ...current, userAbort: true })
          continue
        }

        if (event.type === "session.compaction.ended") {
          const compacted = event.data as { sessionID?: string }
          if (!compacted.sessionID) continue
          const stuck = await readStuck(ctx, compacted.sessionID)
          const learned = await readLearning(ctx)
          const instructions = ctx as unknown as {
            session?: {
              instructions?: {
                entry?: {
                  put(input: { sessionID: string; key: string; value: string }): Promise<unknown>
                }
              }
            }
          }
          try {
            await instructions.session?.instructions?.entry?.put({
              sessionID: compacted.sessionID,
              key: "nii/ledger",
              value: ledgerText(stuck, learned),
            })
          } catch {
            // Ledger restoration is a best-effort aid.
          }
          continue
        }

        if (event.type === "session.idle") {
          const idle = event.data as { sessionID?: string }
          if (!idle.sessionID || !(await isEnabled(ctx, idle.sessionID))) continue
          await applyProofGate(ctx, idle.sessionID)
          continue
        }

        if (event.type === "session.text.ended") {
          const textData = event.data as { sessionID?: string; text?: string }
          if (!textData.sessionID || !(await isEnabled(ctx, textData.sessionID))) continue
          const text = textData.text ?? ""
          const currentActivity = activities.get(textData.sessionID) ?? emptyActivity()
          activities.set(textData.sessionID, recordCompletionTag(currentActivity, text))
          const quit = detectQuitSignals(text)
          const successClaim = isSuccessClaim(text)
          const categories = detectCaseCategories(text)
          if (quit.length === 0 && !successClaim && categories.length === 0) continue

          // A validation report may arrive while a pivot is pending; attach
          // its categories so the strategy is stored with honest bounds.
          if (categories.length > 0) {
            const pending = await readPending(ctx, textData.sessionID)
            if (pending) {
              await writePending(ctx, textData.sessionID, {
                ...pending,
                validation: mergeValidationRecords(pending.validation, categories, text),
              })
            }
          }

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

        const activityNow = activities.get(data.sessionID) ?? emptyActivity()
        const failureText = `${data.error?.type ?? ""} ${toolFailureText(data)}`
        activities.set(data.sessionID, {
          ...recordExit(activityNow, data.metadata?.exit),
          ...(isGenuineBlocker(failureText) ? { blocker: true } : {}),
        })

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
            await syncMemory(data.sessionID)
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
          await writeLearning(
            ctx,
            recordLearning(learned, pending.signatures, pending.strategy, Date.now(), pending.validation),
          )
          await clearPending(ctx, data.sessionID)
          await syncMemory(data.sessionID)
        }
        await writeStuck(ctx, data.sessionID, recordSuccess(current))
      }
    })()

    // 2b. User prompts can contain quit signals too. Without this hook NII
    //     only sees assistant text and a user saying "I can't make it" is
    //     ignored.
    await ctx.session.hook("prompt", async (event) => {
      if (typeof event.prompt.text !== "string") return
      const sid = (event as { sessionID?: string }).sessionID
      if (sid) lastPrompts.set(sid, event.prompt.text)
      const signals = detectQuitSignals(event.prompt.text)
      const directive = quitResponse(signals)
      if (directive) event.prompt.text = `${event.prompt.text}\n\n${directive}`
    })

    // 3. The mandate, escalation, and pivot delivery. The context hook runs
    //    for the agent loop including tool continuations, so the mindset and
    //    the pivot directive survive every step.
    await ctx.session.hook("context", async (event) => {
      if (!(await isEnabled(ctx, event.sessionID))) return

      const stuck = await readStuck(ctx, event.sessionID)
      const activity = activities.get(event.sessionID) ?? emptyActivity()
      if (
        !shouldInjectMandate(
          activity,
          {
            pivots: stuck.pivots,
            refusals: stuck.refusals,
            blockers: stuck.blockers,
            recentLength: stuck.recent.length,
          },
          lastPrompts.get(event.sessionID) ?? "",
        )
      ) {
        return
      }
      event.system.push({ type: "text", text: motivationFor(stuck, maxPivots) })

      // Proactive hint: if strategies are already known to work for this
      // failure signature and no pivot has fired yet, offer them now.
      if (stuck.pivots === 0 && failureCount(stuck) >= 2 && !isExhausted(stuck, maxPivots)) {
        const learned = await readLearning(ctx)
        const known = strategyHints(learned, stuck.ruledOut)
        if (known.length > 0) {
          event.system.push({
            type: "text",
            text: `NII: strategies already known to work for this kind of failure:\n${known.map((item) => `- ${item}`).join("\n")}`,
          })
        }
      }

      if (isExhausted(stuck, maxPivots)) return

      if (stuck.inflight || shouldPivot(stuck, maxPivots)) {
        await withLock(`nii:pivot:${event.sessionID}`, async () => {
          const latest = await readStuck(ctx, event.sessionID)
          let inflight: InflightPivot | undefined = latest.inflight

          if (!inflight) {
            if (!shouldPivot(latest, maxPivots)) return
            let proposal: string
            try {
              const generateText = resolveGenerateText(ctx)
              if (!generateText) throw new Error("no one-shot generation API available")
              const configured = ctx.options?.coachModel as { providerID: string; id: string } | undefined
              const model = configured ?? (await ctx.model.default())
              if (!model) throw new Error("no default model available")

              const learned = await readLearning(ctx)
              const effective = strategyHints(learned, latest.ruledOut)
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
              text: `${pivotMessage(inflight.proposal, beforeDelivery.pivots + 1, maxPivots)}\n\n${buildValidationDirective(stuck.ruledOut)}`,
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
                text: statusText(enabled, "session", stuck.pivots, maxPivots, learned.length, stuck.lastPivot),
              })
              return
            }
            case "ledger": {
              const stuck = await readStuck(ctx, sessionID)
              const learned = await readLearning(ctx)
              await ctx.session.synthetic({
                sessionID,
                text: ledgerText(stuck, learned),
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
