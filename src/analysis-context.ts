import type { EngineSnapshot } from '@haelp/teto/engine';
import { customDefaults, type AdvancedRules, type CustomRules, type ModeRules } from './modes';
import type { Settings } from './settings';

export type AnalysisContext = { version: 1; rules: ModeRules; settings: Settings; snapshot: EngineSnapshot; currentKnown?: boolean; generated?: boolean; pack?: { size: number; nextOffset: number } };
export function withGeneratedPacks(context: AnalysisContext): AnalysisContext {
  context.generated = !context.rules.advanced.sequence;
  const size = context.rules.bag === '7-bag' ? 7 : context.rules.bag === '14-bag' ? 14 : 0;
  if (size && !context.rules.advanced.sequence) context.pack = { size, nextOffset: (size - context.snapshot.queue.value.length % size) % size };
  return context;
}
export function analysisContext(rules: ModeRules, settings: Settings, snapshot: EngineSnapshot): AnalysisContext {
  if (snapshot.board.length !== rules.board.height + rules.board.buffer || snapshot.board.some(row => row.length !== rules.board.width)) throw new Error('Analysis board does not match the active mode.');
  return structuredClone({ version: 1, rules, settings, snapshot });
}
export function frozenAttackRules(rules: AdvancedRules, frame: number): AdvancedRules {
  return { ...rules, garbageMultiplier: rules.garbageMultiplier + Math.max(0, frame - rules.garbageMargin * 60) * rules.garbageIncrease / 60, garbageIncrease: 0, garbageCap: Math.min(rules.garbageCapMax, rules.garbageCap + Math.max(0, frame - rules.garbageCapMargin * 60) * rules.garbageCapIncrease / 60), garbageCapIncrease: 0 };
}
export function customRulesFromMode(rules: ModeRules): CustomRules {
  return { ...structuredClone(customDefaults), gravity: rules.gravity, lockDelay: rules.lockDelay, lockResets: rules.lockResets, infiniteLock: rules.infiniteLock, bag: rules.bag, lineGoal: rules.goals.lines, pieceGoal: rules.goals.pieces, timeLimit: rules.goals.seconds, hold: rules.hold, infiniteHold: rules.infiniteHold, allow180: rules.allow180, nextCount: rules.nextCount, initialGarbage: rules.setup.rows, garbageMessiness: rules.setup.messiness, topout: rules.topout, finesse: rules.finesse, undo: rules.undo, advanced: structuredClone(rules.advanced) };
}
