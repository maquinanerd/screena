/**
 * planning — Planejamento de custo do bootstrap (PURO).
 *
 * Responde, antes de persistir qualquer coisa: quanto custa este bootstrap, e
 * quantos titulos cabem no orcamento?
 */

export {
  DEFAULT_ASSUMPTIONS,
  estimateBootstrapCost,
  estimateScenarios,
  evaluateBudget,
  largestAffordablePrefix,
} from './cost-model.js'

export type {
  BootstrapBudget,
  BudgetDecision,
  BudgetViolation,
  CostAssumptions,
  CostEstimate,
  CostScenarios,
  DiscoveryCost,
  PlannedEntityKind,
  PlannedTitle,
} from './cost-model.js'
