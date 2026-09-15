import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import ts from 'typescript';

const archive = resolve(process.argv[2] ?? '../TETRIO_OFFLINE/offline-data/archive');
const id = '7bf3f1ef242a69502cfd60d444e0a2a33d80b42b13eae7f79ba8e3f58c87ce2d';
const bytes = await readFile(join(archive, 'bodies', `${id}.bin`));
const hash = createHash('sha256').update(bytes).digest('hex');
if (hash !== '87dcd1e0c0fd3da6f25528eea43ddaaccba6a7eb485eccb76262a6f3d1d663c1') throw new Error('The QP reference requires the pinned July 2026 client.');
const metadata = JSON.parse(await readFile(join(archive, 'metadata', `${id}.json`), 'utf8'));
const source = bytes.toString('utf8');
const ast = ts.createSourceFile('tetrio.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const wanted = ['zenithRevivePrompts', 'zenithReviveDecks', 'zenithFatigue', 'zenithFatigueRevEx', 'zenithFatigueRevDuo', 'zenithMods', 'zenithModsShort', 'allowedReverseCards'];
const data = {}, locations = {}, calls = [];
function literal(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(p => [p.name.text, literal(p.initializer)]));
  if (ts.isPrefixUnaryExpression(node)) {
    const value = literal(node.operand);
    if (node.operator === ts.SyntaxKind.ExclamationToken) return !value;
    if (node.operator === ts.SyntaxKind.MinusToken) return -value;
  }
  throw new Error(`Nonliteral reference at ${node.getStart(ast)}: ${node.getText(ast).slice(0,80)}`);
}
function visit(node) {
  if (ts.isPropertyAssignment(node) && node.name.text === 'garbage' && ts.isObjectLiteralExpression(node.initializer) && node.initializer.properties.some(property => property.name?.text === 'TSPIN_MINI_QUAD')) {
    data.garbage = literal(node.initializer); locations.garbage = node.getStart(ast);
  }
  if (ts.isPropertyAssignment(node) && wanted.includes(node.name.text)) {
    data[node.name.text] = literal(node.initializer);
    locations[node.name.text] = node.getStart(ast);
  }
  if (ts.isCallExpression(node) && /(?:IncrementPrompt|BumpPrompt|NixPrompt)/.test(node.expression.getText(ast))) {
    let owner = node;
    while (owner.parent && !ts.isMethodDeclaration(owner) && !ts.isFunctionDeclaration(owner) && !ts.isFunctionExpression(owner)) owner = owner.parent;
    calls.push({ offset: node.getStart(ast), owner: owner.name?.getText(ast) ?? 'anonymous', expression: node.getText(ast) });
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (data.zenithRevivePrompts?.length !== 79 || wanted.some(name => !Object.hasOwn(data, name))) throw new Error('Incomplete QP reference catalog.');
const tasks = data.zenithRevivePrompts.map(([tier, predicate, target, label, labelType, excludes], index) => ({
  id: `${tier.toLowerCase()}-${predicate}-${target}`, index, tier, predicate, target, label, labelType, excludes,
  calls: calls.filter(c => c.expression.includes(`"${predicate}"`)).map(c => c.offset)
}));
await writeFile('src/qp-reference.json', JSON.stringify({
  revision: 'tetrio-v19-20260714', replayVersion: 19, source: { url: metadata.url, capturedAt: metadata.savedAt, sha256: hash, locations },
  tasks, garbage: data.garbage, decks: data.zenithReviveDecks,
  fatigue: { normal: data.zenithFatigue, expert_reversed: data.zenithFatigueRevEx, duo_reversed: data.zenithFatigueRevDuo },
  mods: data.zenithMods, modShortNames: data.zenithModsShort, reverseCards: data.allowedReverseCards
}, null, 2) + '\n');
await mkdir('TEMP/q1-reference', { recursive: true });
await writeFile('TEMP/q1-reference/task-calls.json', JSON.stringify(calls, null, 2) + '\n');
console.log(`Imported ${tasks.length} tasks, ${new Set(tasks.map(t => t.predicate)).size} predicates, ${calls.length} handler calls and ${Object.keys(data.zenithMods).length} mod names.`);
