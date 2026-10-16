import type { CSSProperties } from 'react';
import {
  FORME_FIELD_COOLDOWN,
  FORME_ORDER,
  FORME_SWAP_COOLDOWN,
  FORMES,
} from '@shared/pieces/prototype.ts';

export type FormeId = keyof typeof FORMES;

export interface ProtoView {
  form?: string;
  droneCooldown?: number;
  temporalCooldown?: number;
  formeTurns?: number;
  rebooting?: boolean;
}

export function formeOf(proto?: ProtoView): FormeId {
  return proto?.form && proto.form in FORMES ? (proto.form as FormeId) : 'speed';
}

function formeStyle(id: FormeId): CSSProperties {
  return { '--form': FORMES[id].color } as CSSProperties;
}

/** Forme color for the Prototype's ability-bar buttons. */
export function formeAbilityStyle(abilityId: string, proto?: ProtoView): CSSProperties | undefined {
  if (abilityId === 'forme_status') return formeStyle(formeOf(proto));
  const id = abilityId.slice('forme_'.length);
  return abilityId.startsWith('forme_') && id in FORMES ? formeStyle(id as FormeId) : undefined;
}

/** Eye-colored forme badge drawn over the Prototype on the board. */
export function PrototypeBoardBadges({ proto }: { proto?: ProtoView }) {
  const id = formeOf(proto);
  const info = FORMES[id];
  const rebooting = Boolean(proto?.rebooting);
  const turnsLeft = id !== 'speed' && !rebooting ? proto?.formeTurns ?? 0 : 0;
  return (
    <span className="proto-hud" aria-hidden>
      <i
        className={`proto-forme-badge is-${id}${rebooting ? ' is-rebooting' : ''}`}
        style={formeStyle(id)}
        title={rebooting ? 'Rebooting: shut down this turn, then Speed Forme' : `${info.name} (${info.eyes} eyes)`}
      >
        {info.icon}
      </i>
      {turnsLeft > 0 && (
        <i className="proto-forme-turns" style={formeStyle(id)} title={`${turnsLeft} turns left in ${info.name}`}>
          {turnsLeft}
        </i>
      )}
    </span>
  );
}

/** Current forme, cooldowns, and every forme's rules for the piece inspector. */
export function PrototypeInspector({ proto, swapCooldown }: { proto?: ProtoView; swapCooldown?: number }) {
  const current = formeOf(proto);
  const info = FORMES[current];
  const swapCd = swapCooldown ?? 0;
  const droneCd = proto?.droneCooldown ?? 0;
  const temporalCd = proto?.temporalCooldown ?? 0;
  const rebooting = Boolean(proto?.rebooting);
  const turnsLeft = proto?.formeTurns ?? 0;
  const turns = (n: number) => `${n} turn${n === 1 ? '' : 's'}`;
  return (
    <section className="proto-inspector">
      <div className="proto-inspector-head" style={formeStyle(current)}>
        <strong>
          {rebooting ? 'Rebooting' : `${info.icon} ${info.name} · ${info.eyes} eyes`}
        </strong>
        <em>Forme Swap: {swapCd > 0 ? `recharging (${turns(swapCd)})` : 'ready'}</em>
      </div>
      {rebooting ? (
        <p className="proto-note">Shut down this turn, then returns to {FORMES.speed.name}.</p>
      ) : (
        current !== 'speed' &&
        turnsLeft > 0 && (
          <p className="proto-note">
            {turnsLeft === 1 ? 'Last turn' : `${turnsLeft} turns left`} in {info.name}, then it shuts down for 1 turn
            and returns to {FORMES.speed.name}.
          </p>
        )
      )}
      <p className="proto-note">
        Forme Swap doesn't use your turn. It has a {FORME_SWAP_COOLDOWN}-turn cooldown shared by both Prototypes, and
        neither Prototype can move on the turn you swap.
      </p>
      <ul className="proto-cooldowns">
        <li>Defense drone: {droneCd > 0 ? `recharging (${turns(droneCd)})` : 'ready'}</li>
        <li>Temporal Forme: {temporalCd > 0 ? `recharging (${turns(temporalCd)})` : 'ready'}</li>
      </ul>
      <div className="proto-forms">
        {FORME_ORDER.map((id) => (
          <FormeCard key={id} forme={id} active={id === current} />
        ))}
      </div>
      <p className="proto-note">Defense drones and Temporal Forme each work once every {FORME_FIELD_COOLDOWN} turns.</p>
    </section>
  );
}

export function FormeCard({ forme, active }: { forme: FormeId; active?: boolean }) {
  const info = FORMES[forme];
  return (
    <div className={`form-card${active ? ' is-active' : ''}`} style={formeStyle(forme)}>
      <span className="form-card-head">
        <span className="form-card-icon">{info.icon}</span>
        <span>
          <strong>
            {info.name}
            {active && <em className="form-card-tag">Active</em>}
          </strong>
          <span className="form-card-summary">
            {info.eyes} eyes · {info.summary}
          </span>
        </span>
      </span>
      <ul className="form-card-perks">
        {info.perks.map((perk) => (
          <li key={perk}>
            <span className="form-perk-mark">✓</span>
            <span>{perk}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface FormeToastData {
  key: string;
  mine: boolean;
  forme: FormeId;
}

/** Popup announcing a Forme Swap. */
export function FormeToast({ toast, onClose }: { toast: FormeToastData; onClose: () => void }) {
  const info = FORMES[toast.forme];
  return (
    <button
      type="button"
      className="forme-toast"
      style={formeStyle(toast.forme)}
      onClick={onClose}
      aria-label="Dismiss forme notice"
    >
      <span className="forme-toast-top">{toast.mine ? 'Your' : 'Enemy'} Prototype swapped forme</span>
      <span className="forme-toast-main">
        <span className="forme-toast-icon">{info.icon}</span>
        <span>
          <strong>{info.name}</strong>
          <em>{info.eyes} eyes</em>
        </span>
      </span>
      <ul className="forme-toast-perks">
        {info.perks.map((perk) => (
          <li key={perk}>{perk}</li>
        ))}
      </ul>
    </button>
  );
}
