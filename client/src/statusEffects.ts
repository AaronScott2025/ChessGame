export type EffectTone = 'buff' | 'debuff' | 'neutral' | 'ritual';

export interface EffectMeta {
  label: string;
  name: string;
  tone: EffectTone;
}

/** Short board badges + full names for tooltips / info panel. */
export const EFFECT_META: Record<string, EffectMeta> = {
  bloodlust: { label: 'Bld', name: 'Bloodlust', tone: 'buff' },
  blink: { label: 'Blk', name: 'Blink', tone: 'buff' },
  enchant_ritual: { label: 'Enc', name: 'Enchant ritual', tone: 'ritual' },
  kingsstead: { label: 'Kng', name: 'Kingstead', tone: 'buff' },
  speed_plus_pending: { label: 'Spd…', name: 'Speed Plus (pending)', tone: 'neutral' },
  speed_plus: { label: 'Spd', name: 'Speed Plus', tone: 'buff' },
  movement_plus_pending: { label: 'Mov…', name: 'Movement Plus (pending)', tone: 'neutral' },
  movement_plus: { label: 'Mov', name: 'Movement Plus', tone: 'buff' },
  mathematical: { label: '+1', name: 'Mathematical', tone: 'buff' },
  fortify: { label: 'Frt', name: 'Fortify', tone: 'buff' },
  pause: { label: 'Pse', name: 'Pause', tone: 'debuff' },
  invincible: { label: 'Inv', name: 'Invincible', tone: 'buff' },
  frozen: { label: 'Frz', name: 'Frozen', tone: 'debuff' },
  doublecast_pending: { label: 'DC…', name: 'Doublecast (pending)', tone: 'neutral' },
  doublecast_ready: { label: 'DC', name: 'Doublecast ready', tone: 'buff' },
  echo_armed: { label: 'Eco', name: 'Echo', tone: 'buff' },
  stunned: { label: 'Stn', name: 'Stunned', tone: 'debuff' },
  recall: { label: 'Rcl', name: 'Recall', tone: 'buff' },
  converted: { label: 'Cnv', name: 'Converted', tone: 'neutral' },
  soul_locked: { label: 'Soul', name: 'Soul Locked', tone: 'neutral' },
  immobilized: { label: 'Imm', name: 'Immobilized', tone: 'debuff' },
  webbed: { label: 'Web', name: 'Webbed', tone: 'debuff' },
  wizard_enchant: { label: 'Wiz', name: 'Wizard enchant', tone: 'buff' },
  magic_begone: { label: 'Mbg', name: 'Magic silenced', tone: 'debuff' },
  identity_loot: { label: 'ID', name: 'Identity stored', tone: 'neutral' },
  identity_stolen: { label: 'ID', name: 'Identity Theft', tone: 'buff' },
  ghost_unlocked: { label: 'Gst', name: 'Ghost unlocked', tone: 'buff' },
};

export interface StatusEffectView {
  id?: string;
  kind: string;
  turnsRemaining?: number;
}

/** Collapse Pause's companion flags; hide permanent unlock clutter on the board. */
export function visibleBoardEffects(effects: StatusEffectView[]): StatusEffectView[] {
  const kinds = new Set(effects.map((e) => e.kind));
  return effects.filter((e) => {
    if (e.kind === 'ghost_unlocked') return false;
    if (kinds.has('pause') && (e.kind === 'invincible' || e.kind === 'frozen')) return false;
    return true;
  }).map((e, i) => ({
    ...e,
    id: e.id ?? `${e.kind}-${i}`,
  }));
}

export function effectLabel(kind: string): string {
  return EFFECT_META[kind]?.label ?? kind.slice(0, 3);
}

export function effectName(kind: string): string {
  return EFFECT_META[kind]?.name ?? kind.replace(/_/g, ' ');
}

export function effectTone(kind: string): EffectTone {
  return EFFECT_META[kind]?.tone ?? 'neutral';
}

export function formatEffectTitle(e: StatusEffectView): string {
  const base = effectName(e.kind);
  return e.turnsRemaining != null ? `${base} (${e.turnsRemaining})` : base;
}
