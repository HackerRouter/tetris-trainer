import type { TrainerGame } from './game';
import type { Settings } from './settings';

type Sprite = { offset: number; duration: number };

export class SoundPlayer {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private sprites: Record<string, Sprite> = {};
  private voices = new Set<AudioBufferSourceNode>();
  private recent = new Map<string, number>();
  private options: Settings['audio'];
  private observed: { game: TrainerGame; status: TrainerGame['status']; countdown: number; placements: number; events: number; holds: number; x: number; y: number; rotation: number } | null = null;
  status = 'Loading local sound effects…';

  constructor(options: Settings['audio']) {
    this.options = { ...options };
    try {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.connect(this.context.destination);
      this.configure(options);
      void this.load();
    } catch { this.status = 'Audio is unavailable in this browser.'; }
  }

  private async load() {
    try {
      const response = await fetch('/tetrio/sound-pack.json');
      if (!response.ok) throw new Error(`Sound pack request failed (${response.status})`);
      const pack = await response.json();
      if (pack.version !== 1 || pack.encoding !== 'base64' || typeof pack.data !== 'string' || !pack.sprites || typeof pack.sprites !== 'object') throw new Error('Invalid sound pack');
      const binary = atob(pack.data), bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const buffer = await this.context!.decodeAudioData(bytes.buffer);
      for (const sprite of Object.values(pack.sprites) as Sprite[]) {
        if (!sprite || !Number.isFinite(sprite.offset) || !Number.isFinite(sprite.duration) || sprite.offset < 0 || sprite.duration <= 0 || sprite.offset + sprite.duration > buffer.duration + .01) throw new Error('Invalid sound pack timing');
      }
      this.buffer = buffer;
      this.sprites = pack.sprites;
      this.status = 'Local TETR.IO sound effects ready.';
    } catch (error) { this.status = `Sound effects could not load: ${(error as Error).message}. Reload to try again.`; }
  }

  unlock() { if (this.context?.state === 'suspended') void this.context.resume().catch(() => {}); }

  configure(options: Settings['audio']) {
    this.options = { ...options };
    if (this.gain && this.context) this.gain.gain.setValueAtTime(options.enabled ? options.volume : 0, this.context.currentTime);
  }

  play(name: string, ui = false) {
    const context = this.context, sprite = this.sprites[name];
    if (!context || context.state !== 'running' || !this.buffer || !this.gain || !sprite || !this.options.enabled || !this.options.volume || (ui && !this.options.ui)) return;
    const interval = name === 'move' || name === 'softdrop' || name === 'menuhover' ? .045 : .01;
    if (context.currentTime - (this.recent.get(name) ?? -Infinity) < interval) return;
    this.recent.set(name, context.currentTime);
    if (this.voices.size >= 24) this.voices.values().next().value?.stop();
    const source = context.createBufferSource();
    source.buffer = this.buffer; source.connect(this.gain);
    source.onended = () => { source.disconnect(); this.voices.delete(source); };
    this.voices.add(source);
    source.start(0, sprite.offset, sprite.duration);
  }

  sync(game: TrainerGame) {
    const previous = this.observed, fresh = previous?.game !== game;
    const countdown = Math.ceil(game.countdownFrames / 60), piece = game.engine.falling;
    if (fresh && game.startedAt) this.play('boardappear');
    if (game.status === 'countdown' && (fresh || previous.countdown !== countdown)) this.play(`countdown${Math.min(5, countdown)}`);
    if ((fresh || previous.status !== game.status) && game.status === 'playing' && (fresh || previous.status !== 'paused')) this.play('go');
    if (!fresh && previous.status !== game.status) {
      if (game.status === 'complete') this.play('finish');
      if (game.status === 'topout') this.play('failure');
    }
    if (!fresh) {
      const events = game.events.slice(previous.events);
      for (const event of events) {
        if (event.type === 'undo') this.play('undo');
        if (event.type === 'clear-field') this.play('boardappear');
      }
      if (game.holds > previous.holds) this.play('hold');
      const placements = game.placements.slice(previous.placements);
      for (const placement of placements) {
        if (!placement.accepted) { this.play('finessefault'); continue; }
        const result = placement.result;
        if (placement.inputs.includes('hardDrop')) this.play('harddrop');
        this.play('floor');
        if (result.lines) {
          this.play(result.spin !== 'none' ? 'clearspin' : result.lines >= 4 ? 'clearquad' : 'clearline');
          if (game.engine.stats.combo > 0) this.play(`combo_${Math.min(16, game.engine.stats.combo)}`);
          if (game.engine.stats.b2b > 0 && (result.spin !== 'none' || result.lines >= 4)) this.play('clearbtb');
          if (game.engine.board.perfectClear) this.play('allclear');
        }
      }
      if (!placements.length && game.holds === previous.holds && game.status === 'playing') {
        if (piece.x !== previous.x) this.play('move');
        if (piece.rotation !== previous.rotation) this.play('rotate');
        const softDrop = game.engine.input.keys.softDrop || events.some(event => event.type === 'keydown' && (event.data as { key?: string }).key === 'softDrop');
        if (piece.y < previous.y && softDrop) this.play('softdrop');
      }
    }
    this.observed = { game, status: game.status, countdown, placements: game.placements.length, events: game.events.length, holds: game.holds, x: piece.x, y: piece.y, rotation: piece.rotation };
  }
}
