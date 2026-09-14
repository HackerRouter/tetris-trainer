import type { TrainerGame } from './game';
import type { PracticeScene } from './practice';
import { placementSteps } from './guide';
import { bindingLabel } from './settings';
import { drawBoard } from './renderer';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;

export class PracticeGuide {
  private game: TrainerGame | null = null;
  private scene: PracticeScene | null = null;
  private index = -1;
  constructor() {
    el('practice-guide-animate').addEventListener('click', () => {
      if (!this.game || !this.scene) return;
      this.animate();
      el('practice-guide-animate').blur();
    });
  }
  update(game: TrainerGame) {
    const practice = game.practice, scene = practice && !practice.finished ? practice.set.scenes[practice.index] : null;
    el('practice-guide').hidden = !scene;
    if (game === this.game && scene === this.scene && practice?.index === this.index) return;
    this.game = game; this.scene = scene; this.index = practice?.index ?? -1;
    if (!scene || !practice) return;
    const snapshot = scene.guideSnapshot ?? scene.snapshot, canvas = el<HTMLCanvasElement>('practice-guide-board');
    canvas.width = game.engine.board.width * 18; canvas.height = (game.engine.board.height + 3) * 18;
    drawBoard(canvas, game.engine, snapshot.board, snapshot.falling, scene.target, game.settings.display);
    el('practice-guide-title').textContent = `Step ${this.index + 1} / ${practice.set.scenes.length} · ${snapshot.falling.symbol.toUpperCase()}`;
    const steps = placementSteps(scene.path, game.settings).map(step => step.text);
    if (scene.holdFirst) steps.unshift(`Use Hold (${bindingLabel(game.settings, 'hold')}) first if you have not swapped yet.`);
    el('practice-guide-steps').replaceChildren(...steps.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
    if (practice.set.kind === 'opener') this.animate();
  }
  private animate() {
    if (this.game && this.scene) this.game.demonstration = { ...this.scene, kind: 'guide', snapshot: this.scene.guideSnapshot ?? this.scene.snapshot, serial: Date.now(), sceneNumber: this.index + 1 };
  }
}
