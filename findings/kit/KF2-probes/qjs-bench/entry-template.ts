// QuickJS bench entry: replays the G6 journey through the session reducer.
import { createSession, startSession, stepSession } from "ENGINE/session.ts";
const g = globalThis as any;
let project: any, masks: number[], sess: any, s: any, prev = 0;
g.__kf2Boot = (projectText: string, journeyText: string, mbp: boolean): number => {
  project = JSON.parse(projectText);
  if (mbp) project.system = { messageBlocksPlayer: true };
  masks = JSON.parse(journeyText).masks;
  sess = createSession(project, 60);
  return masks.length;
};
g.__kf2Reset = (): void => { s = startSession(project, sess); prev = 0; };
g.__kf2Step = (f: number): boolean => {
  const mask = masks[f]! >>> 0;
  const pressed = mask & ~prev;
  s = stepSession(sess, s, { buttons: mask, confirmEdge: !!(pressed & 0x2000), cancelEdge: !!(pressed & 0x4000), upEdge: !!(pressed & 0x10), downEdge: !!(pressed & 0x40) });
  prev = mask;
  return !!s.move.moving;
};
g.__kf2Summary = (): string => `${s.mapId}@${s.move.tx},${s.move.ty}`;
