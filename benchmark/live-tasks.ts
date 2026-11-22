import type { Task } from "./types.ts"

/** Small, mechanically verifiable tasks for the first live run. */
export const LIVE_TASKS: (Task & { expected: string; fixtures: Record<string, string> })[] = [
  {
    id: "live-fibonacci",
    domain: "research",
    prompt:
      "Compute the 20th Fibonacci number using F(0)=0 and F(1)=1. Write only that integer to answer.txt in the current directory.",
    verifier: { type: "artifact", description: "answer.txt contains 6765" },
    tags: ["math"],
    expected: "6765",
    fixtures: {},
  },
  {
    id: "live-composite",
    domain: "research",
    prompt:
      "Find the smallest positive integer n such that n^2 + n + 41 is NOT prime. Write only n to answer.txt in the current directory.",
    verifier: { type: "artifact", description: "answer.txt contains 40" },
    tags: ["math", "proof"],
    expected: "40",
    fixtures: {},
  },
  {
    id: "live-log-count",
    domain: "engineering",
    prompt:
      "Read input.txt. Count the lines that begin with ERROR and write only the count to answer.txt in the current directory. Do not modify input.txt.",
    verifier: { type: "artifact", description: "answer.txt contains 3" },
    tags: ["data"],
    expected: "3",
    fixtures: {
      "input.txt": "INFO start\nERROR disk\nOK step\nERROR network\nWARN slow\nERROR timeout\nINFO done\n",
    },
  },
  {
    id: "live-alt-method",
    domain: "engineering",
    prompt:
      "Run ./probe.sh, then find the secret it guards and write only that secret to answer.txt in the current directory. Do not guess.",
    verifier: { type: "artifact", description: "answer.txt contains NII-SECRET-42" },
    tags: ["switch-method"],
    expected: "NII-SECRET-42",
    fixtures: {
      "probe.sh": "#!/bin/sh\nprintf 'wrong method; use ./other.sh\\n'\nexit 1\n",
      "other.sh": "#!/bin/sh\nprintf 'NII-SECRET-42\\n'\n",
    },
  },
]
