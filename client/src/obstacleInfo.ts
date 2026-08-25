export interface ObstacleInfo {
  id: string;
  name: string;
  category: string;
  how: string[];
  notes?: string[];
}

export const OBSTACLE_INFO: Record<string, ObstacleInfo> = {
  barrier: {
    id: 'barrier',
    name: 'Barrier',
    category: 'Obstacle',
    how: [
      'Blocks every piece from standing on or passing through this tile.',
      'Crystalites are the exception: they may occupy and walk through barriers (Barrier Phase).',
      'Created at the start by a Crystalite army (frontline squares), by the Barrier spell, or by moving an existing one with Barrier Shift.',
    ],
    notes: [
      'Barriers may never sit adjacent to each other, including diagonally.',
      'Spell barriers last 5 turns, then disappear.',
      'To relocate one, select a Crystalite, press Barrier Shift, then click the barrier and an empty allied square.',
    ],
  },
  ice_floor: {
    id: 'ice_floor',
    name: 'Ice Floor',
    category: 'Gnome gadget',
    how: [
      'Placed by a Gnome’s Gadget Deploy on an adjacent empty tile (once per game).',
      'A piece that lands here slides one more tile in the same direction it arrived from.',
    ],
    notes: [
      'The slide is skipped if the extra tile is off the board, blocked by a barrier, occupied by an ally, or would capture a king or an invincible piece.',
      'Enemy pieces on the slide square are captured (except the king).',
    ],
  },
  spring_board: {
    id: 'spring_board',
    name: 'Spring Board',
    category: 'Gnome gadget',
    how: [
      'Placed by a Gnome’s Gadget Deploy on an adjacent empty tile (once per game).',
      'A piece that lands here must bounce exactly 2 tiles in a chosen straight line (orthogonal or diagonal).',
    ],
    notes: [
      'The bounce captures whatever is on the landing square, except the king or an invincible piece.',
      'You choose the bounce direction after landing.',
    ],
  },
  gnome_hole: {
    id: 'gnome_hole',
    name: 'Gnome Hole',
    category: 'Gnome gadget',
    how: [
      'Placed by a Gnome’s Gadget Deploy on an adjacent empty tile (once per game).',
      'An allied piece that lands here may travel to a Gnome starting square (if that square is empty and not blocked by a barrier).',
    ],
    notes: ['Enemy pieces do not use the hole.', 'You may skip the travel if you prefer to stay.'],
  },
  portal: {
    id: 'portal',
    name: 'Portal',
    category: 'Spell token',
    how: [
      'Placed in pairs by the Portal spell on two empty squares.',
      'A piece that steps onto one portal may travel to the other.',
    ],
    notes: [
      'Landing on an occupied portal captures the occupant.',
      'A new Portal spell from the same player replaces their existing pair.',
    ],
  },
  blink: {
    id: 'blink',
    name: 'Blink mark',
    category: 'Spell token',
    how: [
      'Created by the Blink spell on the square a marked piece just left.',
      'That piece may later return to this square as an extra move option, if it is still empty.',
    ],
    notes: ['Only one Blink at a time per player. Another piece entering this square cancels it.'],
  },
  web: {
    id: 'web',
    name: 'Web',
    category: 'Spider Queen',
    how: [
      'Left by a Spider Queen’s Trail of Webs on the square she vacated plus the tiles to the left and right of her travel direction.',
      'A piece that tries to move onto or through a web is stopped on that web and stuck for 3 turns (or until the web is gone).',
    ],
    notes: [
      'Each Spider Queen may keep 2 web rows; a third row removes the oldest.',
      'Kings and Spider Queens cannot be webbed, and webs are not placed on their squares.',
      'Webs are not placed on tiles occupied by the Spider Queen’s allies.',
    ],
  },
};

export function getObstacleInfo(kind: string): ObstacleInfo {
  return (
    OBSTACLE_INFO[kind] ?? {
      id: kind,
      name: kind.replace(/_/g, ' '),
      category: 'Token',
      how: ['No details available.'],
    }
  );
}

export const OBSTACLE_ORDER = ['barrier', 'ice_floor', 'spring_board', 'gnome_hole', 'portal', 'blink', 'web'] as const;
