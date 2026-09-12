import type { EngineSnapshot } from '@haelp/teto/engine';
import { customDefaults, type CustomRules, type ModeRules } from './modes';
import type { Settings } from './settings';

export type AnalysisContext = { version: 1; rules: ModeRules; settings: Settings; snapshot: EngineSnapshot };
export function analysisContext(rules: ModeRules, settings: Settings, snapshot: EngineSnapshot): AnalysisContext {
  if (snapshot.board.length !== rules.board.height + rules.board.buffer || snapshot.board.some(row => row.length !== rules.board.width)) throw new Error('Analysis board does not match the active mode.');
  return structuredClone({ version: 1, rules, settings, snapshot });
}
export function customRulesFromMode(rules: ModeRules): CustomRules {
  return { ...structuredClone(customDefaults), gravity: rules.gravity, lockDelay: rules.lockDelay, lockResets: rules.lockResets, infiniteLock: rules.infiniteLock, bag: rules.bag, lineGoal: rules.goals.lines, pieceGoal: rules.goals.pieces, timeLimit: rules.goals.seconds, hold: rules.hold, infiniteHold: rules.infiniteHold, allow180: rules.allow180, nextCount: rules.nextCount, initialGarbage: rules.setup.rows, garbageMessiness: rules.setup.messiness, topout: rules.topout, finesse: rules.finesse, undo: rules.undo, advanced: structuredClone(rules.advanced) };
}
