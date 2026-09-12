type Event = { frame: number; type: string; data: any };
type Recording = { events: Event[]; placements: { frame: number; endFrame?: number; accepted: boolean }[]; result: { sessionTimeMs: number }; timeline?: { version: number; frames: number } };
const resets = new Set(['retry', 'undo']);

export function replayTimeline(recording: Recording) {
  if (recording.timeline?.version === 1) {
    const frames = recording.timeline.frames;
    if (!Number.isInteger(frames) || frames < 0 || frames > 216000 || recording.events.length > 500000 || recording.events.some((event, i) => !Number.isInteger(event.frame) || event.frame < 0 || event.frame > frames || (i > 0 && event.frame < recording.events[i - 1].frame) || resets.has(event.type))) throw new Error('Invalid effective replay timeline.');
    return { events: recording.events, frames };
  }
  const end = Math.max(recording.events.at(-1)?.frame ?? 0, Math.round(recording.result.sessionTimeMs * 60 / 1000));
  if (!Number.isInteger(end) || end < 0 || end > 216000 || recording.events.length > 500000 || recording.events.some((event, i) => !Number.isInteger(event.frame) || event.frame < 0 || event.frame > end || (i > 0 && event.frame < recording.events[i - 1].frame))) throw new Error('Replay frames are unordered or exceed one hour.');
  const source = [...recording.events.map((event, sourceIndex) => ({ ...event, sourceIndex, placementIndex: -1 })), ...recording.placements.flatMap((placement, index) => placement.accepted ? [{ frame: placement.endFrame ?? Math.min(end, placement.frame + 1), type: 'placement', data: { index }, sourceIndex: -1, placementIndex: index }] : [])].sort((a, b) => a.frame - b.frame || Number(b.type === 'placement') - Number(a.type === 'placement'));
  let events: (Event & { sourceIndex: number; placementIndex: number })[] = [], offset = 0;
  for (const event of source) {
    if (resets.has(event.type)) {
      const frame = Math.round(event.data.timeMs * 60 / 1000);
      if (!Number.isInteger(frame) || frame < 0 || frame > event.frame - offset) throw new Error('Invalid replay restore time.');
      events = events.filter(item => (item.type === 'placement' ? item.frame <= frame : item.frame < frame) && (item.placementIndex >= 0 ? event.data.placementCount === undefined || item.placementIndex < event.data.placementCount : event.data.eventCount === undefined || item.sourceIndex < event.data.eventCount));
      offset = event.frame - frame;
      events.push({ frame, type: 'checkpoint', data: structuredClone({ snapshot: event.data.snapshot, room: event.data.room, timeMs: event.data.timeMs }), sourceIndex: event.sourceIndex, placementIndex: -1 });
      events.push({ frame, type: 'release-all', data: {}, sourceIndex: event.sourceIndex, placementIndex: -1 });
    } else if (!['pause', 'input-resume', 'think-setting'].includes(event.type)) events.push({ ...event, frame: event.frame - offset });
  }
  return { events: events.map(({ sourceIndex, placementIndex, ...event }) => event), frames: Math.max(0, end - offset) };
}
