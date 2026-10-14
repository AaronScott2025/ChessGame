import { useState, type CSSProperties } from 'react';
import {
  FINAL_EVOLUTION_AT,
  FINAL_FORMS,
  MUTATION_KINDS,
  MUTATIONS,
  type MutationKind,
} from '@shared/pieces/prototype.ts';

export type FormId = keyof typeof FINAL_FORMS;

export interface ProtoView {
  gained: number;
  upgrades: string[];
  history?: string[];
  form?: string;
  hull: number;
  shield: number;
  bulwark?: number;
  surge: number;
  motor: number;
  thermal: number;
  lockdown?: number;
  chainUses?: number;
  quantumUses?: number;
  teleportCooldown?: number;
  empCooldown?: number;
  droneLaunched?: boolean;
}

function formInfo(form?: string) {
  return form && form in FINAL_FORMS ? FINAL_FORMS[form as FormId] : null;
}

const KIND_ORDER: MutationKind[] = ['offense', 'mobility', 'defense', 'utility'];

function kindOf(id: string): MutationKind {
  return MUTATIONS[id]?.kind ?? 'instability';
}

function kindStyle(id: string): CSSProperties {
  return { '--mut': MUTATION_KINDS[kindOf(id)].color } as CSSProperties;
}

/** Short live state for an upgrade (charges, cooldowns, spent). */
function upgradeState(id: string, p: ProtoView): string | null {
  switch (id) {
    case 'reinforced_hull':
      return p.hull > 0 ? 'Armed' : 'Spent';
    case 'energy_shield':
      return `${p.shield} charge${p.shield === 1 ? '' : 's'}`;
    case 'chain_assault':
      return (p.chainUses ?? 0) > 0 ? 'Used' : 'Ready';
    case 'quantum_drive':
      return (p.quantumUses ?? 0) > 0 ? 'Used' : 'Ready';
    case 'teleport_relay':
      return (p.teleportCooldown ?? 0) > 0 ? `Recharging ${p.teleportCooldown}` : 'Ready';
    case 'emp_burst':
      return (p.empCooldown ?? 0) > 0 ? `Recharging ${p.empCooldown}` : 'Ready';
    case 'drone_launcher':
      return p.droneLaunched ? 'Used' : 'Ready';
    default:
      return null;
  }
}

function activeInstabilities(p: ProtoView): Array<{ id: string; note: string }> {
  const out: Array<{ id: string; note: string }> = [];
  if (p.surge > 0) out.push({ id: 'power_surge', note: 'Active' });
  if (p.motor > 0) out.push({ id: 'motor_failure', note: 'Active' });
  if (p.thermal > 0) out.push({ id: 'thermal_overload', note: 'Active' });
  if ((p.lockdown ?? 0) > 0) out.push({ id: 'core_fracture', note: 'Locked down' });
  return out;
}

/** Counter, kind-colored pips, and warning flags drawn over the Prototype on the board. */
export function PrototypeBoardBadges({ proto }: { proto?: ProtoView }) {
  const p = proto;
  const gained = p?.gained ?? 0;
  const upgrades = p?.upgrades ?? [];
  const unstable = p ? activeInstabilities(p) : [];
  const form = formInfo(p?.form);
  const ready = gained >= FINAL_EVOLUTION_AT && !form;
  return (
    <span className="proto-hud" aria-hidden>
      <i
        className={`proto-count${ready ? ' is-ready' : ''}${form ? ' is-evolved' : ''}`}
        style={form ? ({ '--form': form.color } as CSSProperties) : undefined}
        title={`${gained} mutation${gained === 1 ? '' : 's'}${form ? ` · ${form.name} form` : ''}`}
      >
        {gained}
      </i>
      {form && (
        <i className="proto-form-badge" style={{ '--form': form.color } as CSSProperties} title={`${form.name} form`}>
          {form.icon}
        </i>
      )}
      {upgrades.length > 0 && (
        <span className="proto-pips">
          {upgrades.map((id) => (
            <i
              key={id}
              className="proto-pip"
              style={kindStyle(id)}
              title={`${MUTATIONS[id]?.name}: ${MUTATIONS[id]?.text}`}
            >
              {MUTATIONS[id]?.icon}
            </i>
          ))}
        </span>
      )}
      {(unstable.length > 0 || (p && (p.hull > 0 || p.shield > 0 || (p.bulwark ?? 0) > 0))) && (
        <span className="proto-flags">
          {p && form?.id === 'fortress' && (p.bulwark ?? 0) > 0 && (
            <i className="proto-flag is-guard" title="Fortress Bulwark ready">🧱</i>
          )}
          {p && p.hull > 0 && upgrades.includes('reinforced_hull') && (
            <i className="proto-flag is-guard" title="Reinforced Hull armed">🛡</i>
          )}
          {p && p.shield > 0 && upgrades.includes('energy_shield') && (
            <i className="proto-flag is-guard" title={`Energy Shield: ${p.shield}`}>🔷</i>
          )}
          {unstable.map((u) => (
            <i key={u.id} className="proto-flag is-unstable" title={`${MUTATIONS[u.id].name}: ${u.note}`}>
              {MUTATIONS[u.id].icon}
            </i>
          ))}
        </span>
      )}
    </span>
  );
}

/** Full mutation breakdown for the piece inspector. */
export function PrototypeInspector({ proto }: { proto?: ProtoView }) {
  const p: ProtoView = proto ?? {
    gained: 0,
    upgrades: [],
    hull: 0,
    shield: 0,
    surge: 0,
    motor: 0,
    thermal: 0,
  };
  const history = p.history ?? [];
  const nextArt = p.gained >= 6 ? null : (Math.floor(p.gained / 2) + 1) * 2;
  const unstable = activeInstabilities(p);
  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    ids: p.upgrades.filter((id) => kindOf(id) === kind),
  })).filter((g) => g.ids.length);

  const form = formInfo(p.form);

  return (
    <section className="proto-inspector">
      <div className="proto-inspector-head">
        <strong>
          Mutations: {p.gained}
          {form ? ` · ${form.icon} ${form.name} form` : ''}
        </strong>
        <em>
          {form
            ? 'Final Evolution complete'
            : p.gained >= FINAL_EVOLUTION_AT
              ? 'Final Evolution ready: tap Final Evolution in the ability bar'
              : `${FINAL_EVOLUTION_AT - p.gained} more to Final Evolution`}
        </em>
      </div>
      <div className="proto-progress" aria-label={`${Math.min(p.gained, FINAL_EVOLUTION_AT)} of ${FINAL_EVOLUTION_AT}`}>
        {Array.from({ length: FINAL_EVOLUTION_AT }, (_, i) => {
          const id = history[i];
          return (
            <i
              key={i}
              className={`proto-progress-seg${i < p.gained ? ' is-filled' : ''}`}
              style={id ? kindStyle(id) : undefined}
              title={id ? MUTATIONS[id]?.name : i < p.gained ? 'Mutation' : 'Not yet'}
            >
              {id ? MUTATIONS[id]?.icon : ''}
            </i>
          );
        })}
      </div>
      {nextArt != null && <p className="proto-note">Armor upgrades at {nextArt} mutations.</p>}

      {form ? (
        <FormCard form={form.id} active />
      ) : (
        <details className="proto-forms" open={p.gained >= FINAL_EVOLUTION_AT}>
          <summary>Final Evolution forms (choose one at {FINAL_EVOLUTION_AT} mutations)</summary>
          {(Object.keys(FINAL_FORMS) as FormId[]).map((id) => (
            <FormCard key={id} form={id} />
          ))}
        </details>
      )}

      {grouped.length === 0 && unstable.length === 0 && (
        <p className="proto-note">No mutations yet. Capture an enemy or survive a night to mutate.</p>
      )}

      {grouped.map((g) => (
        <div key={g.kind} className="proto-group">
          <h4 style={{ color: MUTATION_KINDS[g.kind].color }}>{MUTATION_KINDS[g.kind].label}</h4>
          {g.ids.map((id) => {
            const m = MUTATIONS[id];
            const st = upgradeState(id, p);
            return (
              <div key={id} className="proto-mut" style={kindStyle(id)}>
                <span className="proto-mut-icon">{m?.icon}</span>
                <span className="proto-mut-body">
                  <span className="proto-mut-name">
                    {m?.name ?? id}
                    {st && <em className="proto-mut-state">{st}</em>}
                  </span>
                  <span className="proto-mut-text">{m?.text}</span>
                </span>
              </div>
            );
          })}
        </div>
      ))}

      {unstable.length > 0 && (
        <div className="proto-group">
          <h4 style={{ color: MUTATION_KINDS.instability.color }}>Unstable</h4>
          {unstable.map((u) => (
            <div key={u.id} className="proto-mut" style={kindStyle(u.id)}>
              <span className="proto-mut-icon">{MUTATIONS[u.id].icon}</span>
              <span className="proto-mut-body">
                <span className="proto-mut-name">
                  {MUTATIONS[u.id].name}
                  <em className="proto-mut-state is-bad">{u.note}</em>
                </span>
                <span className="proto-mut-text">{MUTATIONS[u.id].text}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** A Final Evolution form with its perks. */
export function FormCard({
  form,
  active,
  selected,
  onSelect,
}: {
  form: FormId;
  active?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const info = FINAL_FORMS[form];
  const body = (
    <>
      <span className="form-card-head">
        <span className="form-card-icon">{info.icon}</span>
        <span>
          <strong>
            {info.name}
            {active && <em className="form-card-tag">Active</em>}
          </strong>
          <span className="form-card-summary">{info.summary}</span>
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
    </>
  );
  const style = { '--form': info.color } as CSSProperties;
  const cls = `form-card${active ? ' is-active' : ''}${selected ? ' is-selected' : ''}`;
  return onSelect ? (
    <button type="button" className={cls} style={style} onClick={onSelect} aria-pressed={selected}>
      {body}
    </button>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}

/** Side-by-side comparison of the three forms, with an explicit confirm. */
export function EvolutionPicker({
  onChoose,
  onClose,
}: {
  onChoose: (form: FormId) => void;
  onClose: () => void;
}) {
  const [pick, setPick] = useState<FormId | null>(null);
  return (
    <div className="evolve-picker-backdrop" onClick={onClose}>
      <div
        className="evolve-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Choose a Final Evolution"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="msg-dismiss" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <h3>Final Evolution</h3>
        <p className="evolve-picker-sub">
          Pick one form. It's permanent and doesn't use your turn.
        </p>
        <div className="evolve-picker-forms">
          {(Object.keys(FINAL_FORMS) as FormId[]).map((id) => (
            <FormCard key={id} form={id} selected={pick === id} onSelect={() => setPick(id)} />
          ))}
        </div>
        <button
          type="button"
          className="primary evolve-picker-confirm"
          disabled={!pick}
          style={pick ? ({ '--form': FINAL_FORMS[pick].color } as CSSProperties) : undefined}
          onClick={() => pick && onChoose(pick)}
        >
          {pick ? `Evolve into ${FINAL_FORMS[pick].icon} ${FINAL_FORMS[pick].name}` : 'Select a form'}
        </button>
      </div>
    </div>
  );
}

export interface MutationToastData {
  key: string;
  mine: boolean;
  gained: number;
  mutationId?: string;
  formId?: FormId;
}

/** Popup card announcing a freshly rolled mutation or a Final Evolution. */
export function MutationToast({ toast, onClose }: { toast: MutationToastData; onClose: () => void }) {
  if (toast.formId) {
    const info = FINAL_FORMS[toast.formId];
    return (
      <button
        type="button"
        className="mutation-toast is-evolution"
        style={{ '--mut': info.color } as CSSProperties}
        onClick={onClose}
        aria-label="Dismiss evolution notice"
      >
        <span className="mutation-toast-top">{toast.mine ? 'Your' : 'Enemy'} Prototype evolved!</span>
        <span className="mutation-toast-main">
          <span className="mutation-toast-icon">{info.icon}</span>
          <span>
            <strong>{info.name} form</strong>
            <em>Final Evolution</em>
          </span>
        </span>
        <span className="mutation-toast-text">{info.summary}</span>
        <ul className="mutation-toast-perks">
          {info.perks.map((perk) => (
            <li key={perk}>{perk}</li>
          ))}
        </ul>
      </button>
    );
  }
  const mutationId = toast.mutationId ?? '';
  const m = MUTATIONS[mutationId];
  const kind = MUTATION_KINDS[m?.kind ?? 'instability'];
  return (
    <button
      type="button"
      className={`mutation-toast${m?.kind === 'instability' ? ' is-unstable' : ''}`}
      style={{ '--mut': kind.color } as CSSProperties}
      onClick={onClose}
      aria-label="Dismiss mutation notice"
    >
      <span className="mutation-toast-top">
        {toast.mine ? 'Your' : 'Enemy'} Prototype mutated · #{toast.gained}
      </span>
      <span className="mutation-toast-main">
        <span className="mutation-toast-icon">{m?.icon}</span>
        <span>
          <strong>{m?.name ?? mutationId}</strong>
          <em>{kind.label}</em>
        </span>
      </span>
      <span className="mutation-toast-text">{m?.text}</span>
    </button>
  );
}
