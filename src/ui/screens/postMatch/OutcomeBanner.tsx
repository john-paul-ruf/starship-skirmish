// M14 UI — Post-match outcome hero: headline + seed box + replay promise (§4.11).
//
// The payoff's headline (FR-27 — VICTORY / DEFEAT / MUTUAL DESTRUCTION, no other
// state exists) and the match seed as a first-class, copyable object with the
// verbatim replay promise. All user-facing strings render as text nodes.

import { useSignal } from '@preact/signals';

import { Button, Chip } from '../../components/index.js';
import type { MatchOutcome } from '../../../sim/index.js';

import { outcomeHeadline, outcomeTone, type OutcomeTone } from './model.js';

/** The verbatim §4.11 promise — the whole point of surfacing the seed. */
const REPLAY_PROMISE = 'Same seed + same plans = identical outcome. Replayable.';

const TONE_CLASS: Readonly<Record<OutcomeTone, string>> = {
  win: 'c-green',
  loss: 'c-red',
  mutual: '',
};

const TONE_VAR: Readonly<Record<OutcomeTone, string>> = {
  win: 'var(--green)',
  loss: 'var(--red)',
  mutual: 'var(--violet)',
};

const SUBHEAD: Readonly<Record<OutcomeTone, string>> = {
  win: '✓ LAST FLEET STANDING',
  loss: 'OPPOSING FLEET STANDING',
  mutual: 'NO WINNER — ALL FLEETS ELIMINATED',
};

export interface OutcomeBannerProps {
  readonly outcome: MatchOutcome;
  readonly playerFleetId: number;
  readonly seedLabel: string;
}

export function OutcomeBanner(props: OutcomeBannerProps) {
  const { outcome, playerFleetId, seedLabel } = props;
  const headline = outcomeHeadline(outcome, playerFleetId);
  const tone = outcomeTone(outcome, playerFleetId);
  const copied = useSignal(false);

  const copySeed = () => {
    const clip = navigator.clipboard;
    if (clip !== undefined) void clip.writeText(seedLabel);
    copied.value = true;
  };

  return (
    <section class="panel ticks">
      <div class="panel-bd" style="display:flex;gap:var(--s5);flex-wrap:wrap;align-items:flex-start">
        <div class="grow" style="min-width:min(340px,100%)">
          <div class="t-label" style="margin-bottom:10px">MATCH OUTCOME · FR-27</div>
          <div
            class={`t-display ${TONE_CLASS[tone]}`}
            data-testid="outcome-headline"
            style={`color:${TONE_VAR[tone]}`}
          >
            {headline}
          </div>
          <div class="t-h2" style={`margin-top:10px;color:${TONE_VAR[tone]}`}>
            {SUBHEAD[tone]}
          </div>
          <div class="mono-xs" style="margin-top:6px">
            {`DECIDED ON TURN ${String(outcome.turns)}`}
          </div>
        </div>

        <div style="width:min(430px,100%);flex:none">
          <div class="t-label" style="margin-bottom:8px">MATCH SEED</div>
          <div
            class="panel-in"
            style="display:flex;align-items:center;gap:var(--s3);padding:var(--s3);border-left:2px solid var(--cyan)"
          >
            <div class="grow" style="min-width:0">
              <div class="t-h1 c-cyan truncate" data-testid="seed-value">
                {seedLabel}
              </div>
            </div>
            <Button onClick={copySeed} aria-label="Copy match seed">
              <span data-testid="seed-copy">{copied.value ? '✓ COPIED' : '⧉ COPY'}</span>
            </Button>
          </div>
          <p class="mono-xs" style="margin:10px 0 0;line-height:1.6">
            <strong class="c-hi">{REPLAY_PROMISE}</strong>{' '}
            Every roll came from this one seed — hand it over with the fleet file and the
            exact same battle replays.
          </p>
          {tone === 'mutual' ? (
            <Chip tone="neutral" class="mono-xs" >SUMMARY, SEED AND LOG WRITTEN IN FULL</Chip>
          ) : null}
        </div>
      </div>
    </section>
  );
}
