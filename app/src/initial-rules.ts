export type InitialRules = { floor: number; target: number; act: number; budget: number; migrate: boolean; exit: boolean }

export function validInitialRules(rules: InitialRules): boolean {
  return rules.floor >= 0 && rules.floor < rules.target && rules.target + 0.1 < rules.act && rules.act < 100 && rules.budget >= 0 && rules.budget <= 100
}
