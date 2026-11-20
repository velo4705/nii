/** Pure parsing for the /nii command, kept separate so it can be tested. */

export type NiiCommand = "on" | "off" | "reset" | "status" | "help"

export function parseNiiCommand(text: string): NiiCommand {
  const arg = text.trim().split(/\s+/)[0]?.toLowerCase() ?? ""

  switch (arg) {
    case "on":
      return "on"
    case "off":
      return "off"
    case "reset":
      return "reset"
    case "status":
      return "status"
    default:
      return "help"
  }
}
