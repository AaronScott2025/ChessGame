import { useEffect } from 'react';
import { PIECE_INFO, type PieceInfo } from './pieceInfo';

const CLASS_SECTIONS: Array<{ title: string; ids: string[] }> = [
  { title: 'Pawns', ids: ['pawn', 'nwap', 'rogue', 'enchanted_pawn'] },
  { title: 'Rooks', ids: ['rook', 'stoneman', 'gnome'] },
  { title: 'Knights', ids: ['horse', 'snake', 'pig'] },
  { title: 'Bishops', ids: ['bishop', 'scamman', 'wizard'] },
  { title: 'Queens', ids: ['queen', 'angel', 'ghost', 'reaper'] },
  { title: 'Wildcards', ids: ['prince_princess', 'demon', 'mimic'] },
  { title: 'King', ids: ['king'] },
];

function formatNamedLine(line: string) {
  const chargeNamed = line.match(/^(\d\+:\s*.+?)\s+[—–-]\s+(.+)$/);
  if (chargeNamed) {
    return (
      <>
        <strong>{chargeNamed[1]}</strong> — {chargeNamed[2]}
      </>
    );
  }
  const colon = line.indexOf(': ');
  if (colon > 0) {
    return (
      <>
        <strong>{line.slice(0, colon)}</strong>
        {line.slice(colon)}
      </>
    );
  }
  return line;
}

function PieceRulesCard({ piece }: { piece: PieceInfo }) {
  return (
    <article className="rules-piece" id={`rules-${piece.id}`}>
      <header className="rules-piece-head">
        <h3>{piece.name}</h3>
        <span className="rules-piece-class">{piece.classLabel}</span>
      </header>
      <div className="rules-piece-body">
        <section>
          <h4>Movement</h4>
          <ul>
            {piece.movement.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
        {piece.abilities.length > 0 && (
          <section>
            <h4>Abilities</h4>
            <ul>
              {piece.abilities.map((line) => (
                <li key={line}>{formatNamedLine(line)}</li>
              ))}
            </ul>
          </section>
        )}
        {piece.misc && piece.misc.length > 0 && (
          <section>
            <h4>Notes</h4>
            <ul>
              {piece.misc.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </article>
  );
}

export function RulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const printRules = () => {
    document.documentElement.classList.add('printing-rules');
    const cleanup = () => {
      document.documentElement.classList.remove('printing-rules');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    // Fallback if afterprint never fires
    window.setTimeout(cleanup, 1000);
  };

  return (
    <div className="rules-overlay" role="dialog" aria-modal="true" aria-labelledby="rules-title">
      <div className="rules-chrome no-print">
        <div className="rules-chrome-copy">
          <p id="rules-title" className="rules-chrome-brand">
            Chesspansion
          </p>
          <p className="rules-chrome-sub">Official rules</p>
        </div>
        <div className="rules-chrome-actions">
          <button type="button" className="primary" onClick={printRules}>
            Save as PDF
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="rules-scroll">
        <article className="rules-book">
          <header className="rules-cover rules-page">
            <p className="rules-cover-eyebrow">Rulebook</p>
            <h1>Chesspansion</h1>
            <p className="rules-cover-lede">
              Draft strange armies, weave spell cards, and fight across a 10×10 realm of day and night.
            </p>
            <p className="rules-cover-foot">How to play · Piece variants · Day &amp; night</p>
          </header>

          <section className="rules-page">
            <h2>What changed</h2>
            <p>
              Chesspansion expands classic chess onto a <strong>10×10</strong> board and adds a sixth piece
              class — the <strong>Wildcard</strong> — built around a direct gimmick. Many opening lines and
              gambits from 8×8 chess no longer apply.
            </p>
          </section>

          <section className="rules-page">
            <h2>Starting the game</h2>
            <p>
              Build your army by drafting <strong>one variant of each class</strong>: Pawn, Rook, Bishop,
              Knight, Wildcard, and Queen (plus your King). You cannot mix variants of the same class during
              army building (e.g. Pawn and Rogue together).
            </p>
            <ul>
              <li>
                <strong>Black</strong> decides who drafts first. Players then alternate picking variants.
              </li>
              <li>
                Place your pawn row on the <strong>2nd rank</strong> from your side.
              </li>
              <li>
                On the back rank, left to right:{' '}
                <em>Rook, Knight, Wildcard, Bishop, Queen, King, Bishop, Wildcard, Knight, Rook</em>.
              </li>
            </ul>
          </section>

          <section className="rules-page">
            <h2>Opening hand</h2>
            <p>After armies are placed, each player draws <strong>3 spell cards</strong>.</p>
            <ul>
              <li>No duplicate spells in the opening hand — redraw if you draw a duplicate.</li>
              <li>No Rally cards in the opening hand — redraw if you draw one.</li>
              <li>
                Once, during this opening only, you may discard one card to draw a replacement. If you waive
                it, you cannot exchange later.
              </li>
              <li>You cannot cast those cards until the first night of the game.</li>
            </ul>
          </section>

          <section className="rules-page">
            <h2>Turn structure</h2>
            <ol>
              <li>
                <strong>Spell</strong> — Optionally cast one spell. Instant effects discard when finished;
                lasting effects stay face-up. You may only cast one spell per turn unless an effect says
                otherwise. Spell cards cannot be used until the <strong>first night</strong>; after that they
                work as normal.
              </li>
              <li>
                <strong>Movement</strong> — Move or activate exactly one piece, then the turn ends.
              </li>
            </ol>
            <p className="rules-callout">
              If you put the opponent in check at any point during your turn, it immediately becomes their
              turn — including through spells, skips, or abilities. There are no exceptions.
            </p>
          </section>

          <section className="rules-page">
            <h2>Day &amp; night</h2>
            <p>
              Every <strong>5 full turn cycles</strong> (both players acting), the board flips between day
              and night. White tracks the cycle. A full day–night cycle is <strong>10 turn cycles</strong>{' '}
              (20 half-turns).
            </p>
            <ul>
              <li>At the start of each new day, both players draw <strong>2 cards</strong>.</li>
              <li>Hand size is capped at <strong>5</strong>. If a draw would go over 5, you still see the card, then must discard down to 5 before anything else.</li>
              <li>
                Spell cards stay in your hand from the opening, but cannot be cast until the first night.
              </li>
              <li>Some pieces only act by day or by night — see their entries.</li>
            </ul>
          </section>

          <section className="rules-page">
            <h2>Territory, barriers &amp; movement boosts</h2>
            <ul>
              <li>
                <strong>Allied / enemy territory</strong> — your first five ranks from your side, and theirs.
              </li>
              <li>
                <strong>Barriers</strong> may never sit adjacent (including diagonally).
              </li>
              <li>
                Movement boosts: queens (range 10) may bend one extra step; L-movers add to a leg; area
                movers grow their area; directional movers gain one more step along a legal line.
              </li>
              <li>
                Boosting the king takes <strong>4 turns</strong> to apply, cannot stack, and cannot be
                refreshed while one is active.
              </li>
              <li>You cannot cast abilities on an enemy king.</li>
              <li>
                Unless an ability says otherwise, revives appear on a legal starting square for that piece.
                If none are free, the revive is illegal and does nothing (the ability is not spent).
              </li>
              <li>General chess rules still apply unless contradicted here.</li>
            </ul>
          </section>

          {CLASS_SECTIONS.map((section) => (
            <section key={section.title} className="rules-page rules-class-section">
              <h2>{section.title}</h2>
              <div className="rules-piece-grid">
                {section.ids.map((id) => {
                  const piece = PIECE_INFO[id];
                  return piece ? <PieceRulesCard key={id} piece={piece} /> : null;
                })}
              </div>
            </section>
          ))}

          <footer className="rules-page rules-end">
            <p className="rules-cover-brand">Chesspansion</p>
            <p>End of rulebook · Print or save this page as a PDF from your browser.</p>
          </footer>
        </article>
      </div>
    </div>
  );
}
