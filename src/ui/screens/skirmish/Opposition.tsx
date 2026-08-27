// M14 UI — Skirmish Setup · opposition (S04 CP2).
//
// 1–4 opponent fleets, each with a difficulty tier + a reroll, and the FULL
// generated bot fleet shown before launch (FR-11 / §4.10). Bots are visibly
// fair: every fleet is drawn from the SAME catalog at the SAME budget and totals
// to ≤ budget; the tier line states what difficulty changes in the player's
// words — NEVER a stat, point discount, or exclusive hull (Custom Rule 4 /
// FR-30; those fields do not exist to render).
//
// Bot-fleet generation is memoised on `(budget, tier, rngKey)` so a re-render
// (e.g. a sibling card's tier change) does not silently re-roll a fleet.

import { useMemo } from 'preact/hooks';

import type { Catalog } from '../../../catalog/index.js';
import type { Build } from '../../../domain/index.js';
import { BOT_TIERS, generateBotFleet, type BotTier } from '../../../ai/index.js';
import { Button, Chip, FleetGlyph, Segmented, type FleetId } from '../../components/index.js';
import type { BotSpec } from '../../matchContext.js';

import { tierBrief } from './model.js';

const TIER_LABEL: Readonly<Record<BotTier, string>> = {
  rookie: 'Rookie',
  veteran: 'Veteran',
  ace: 'Ace',
};

export interface OppositionProps {
  readonly catalog: Catalog;
  readonly bots: readonly BotSpec[];
  readonly budget: number;
  readonly minBots: number;
  readonly maxBots: number;
  readonly onSetCount: (count: number) => void;
  readonly onSetTier: (index: number, tier: BotTier) => void;
  readonly onReroll: (index: number) => void;
}

export function Opposition({
  catalog,
  bots,
  budget,
  minBots,
  maxBots,
  onSetCount,
  onSetTier,
  onReroll,
}: OppositionProps) {
  const countOptions: number[] = [];
  for (let n = minBots; n <= maxBots; n += 1) countOptions.push(n);
  const fleetCount = bots.length + 1;

  return (
    <section class="col skm-opposition">
      <section class="panel ticks" style="flex:none">
        <div class="panel-hd">
          <span class="t-h2">Opposition</span>
          <span class="grow" />
          <Chip tone="cyan">{`${String(fleetCount)} FLEETS`}</Chip>
        </div>
        <div class="panel-bd">
          <div class="skm-count-row">
            <span class="t-label">AI Opponents</span>
            <div data-testid="bot-count-seg">
              <Segmented
                aria-label="Number of AI opponents"
                value={String(bots.length)}
                options={countOptions.map((n) => ({ value: String(n), label: String(n) }))}
                onChange={(v) => {
                  onSetCount(Number(v));
                }}
              />
            </div>
          </div>
          <div class="mono-xs" style="margin-top:var(--s2)">
            {`EACH BOT FLEET IS BUILT TO THE SAME `}
            <strong class="c-hi">{String(budget)}</strong>
            {`-PT BUDGET FROM THE SAME CATALOG (v${String(catalog.catalogVersion)}).`}
          </div>
        </div>
      </section>

      {/* ---- Fairness statement (§4.10 / FR-30) ---- */}
      <section class="panel skm-fairness" style="flex:none">
        <div class="panel-bd">
          <div class="skm-fairness-lead">
            BOTS USE THE SAME CATALOG, THE SAME BUDGET, AND THE SAME RULES. DIFFICULTY CHANGES
            DECISION QUALITY ONLY — NEVER STATS, NEVER POINT DISCOUNTS, NEVER EXCLUSIVE HULLS.
          </div>
          <div class="mono-xs skm-fairness-table">
            {BOT_TIERS.map((tier) => (
              <div key={tier}>
                <strong class="c-hi">{TIER_LABEL[tier].toUpperCase()}</strong>
                {` — ${tierBrief(tier)}`}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- One card per opponent, full fleet shown (FR-11) ---- */}
      {bots.map((spec, index) => (
        <BotCard
          key={index}
          catalog={catalog}
          budget={budget}
          fleetId={((index + 1) % 5) as FleetId}
          ordinal={index + 1}
          spec={spec}
          onSetTier={(tier) => {
            onSetTier(index, tier);
          }}
          onReroll={() => {
            onReroll(index);
          }}
        />
      ))}
    </section>
  );
}

// ---- BotCard --------------------------------------------------------------

interface BotCardProps {
  readonly catalog: Catalog;
  readonly budget: number;
  readonly fleetId: FleetId;
  readonly ordinal: number;
  readonly spec: BotSpec;
  readonly onSetTier: (tier: BotTier) => void;
  readonly onReroll: () => void;
}

const chassisLabel = (catalog: Catalog, chassisId: string): string => {
  const chassis = catalog.chassis(chassisId);
  if (chassis === undefined) return chassisId.toUpperCase();
  return `${chassis.name.toUpperCase()} · ${chassis.classId.replace('-', ' ').toUpperCase()}`;
};

function BotCard({ catalog, budget, fleetId, ordinal, spec, onSetTier, onReroll }: BotCardProps) {
  // FR-11 / §4.10: the fleet is a pure function of (budget, tier, rngKey) —
  // memoise so an unrelated re-render never re-rolls it.
  const fleet = useMemo(
    () => generateBotFleet(catalog, budget, spec.tier, spec.rngKey),
    [catalog, budget, spec.tier, spec.rngKey],
  );
  const total = fleet.reduce((sum: number, s: Build) => sum + s.storedCost, 0);
  const label = `BOT-${String(ordinal).padStart(2, '0')}`;

  return (
    <section class="panel skm-bot-card" data-testid="bot-card" style="flex:none">
      <div class="panel-hd">
        <FleetGlyph fleetId={fleetId} label={label} />
        <span class="t-h2">{label}</span>
        <span class="grow" />
        <Segmented
          aria-label={`${label} difficulty`}
          value={spec.tier}
          options={BOT_TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] }))}
          onChange={(v) => {
            onSetTier(v);
          }}
        />
      </div>
      <div class="panel-bd" style="padding-bottom:var(--s2)">
        <div class="mono-xs" style="color:var(--cyan)" data-testid="bot-tier-note">
          {tierBrief(spec.tier)}
        </div>
      </div>

      <div class="skm-bot-fleet">
        {fleet.map((ship, i) => (
          <div class="row" key={`${ship.id}-${String(i)}`} style="padding:var(--s1) var(--s3)">
            <span class="grow truncate skm-row-name">
              {ship.name.length > 0 ? ship.name : '(unnamed)'}
            </span>
            <span class="mono-xs">{chassisLabel(catalog, ship.chassisId)}</span>
            <span class="t-num" style="min-width:30px;text-align:right">
              {String(ship.storedCost)}
            </span>
          </div>
        ))}
      </div>

      <div class="panel-ft skm-bot-ft">
        <span class="mono-xs">
          <strong class="c-hi">{String(total)}</strong>
          {` / ${String(budget)} PTS · ${String(fleet.length)} HULLS`}
        </span>
        <span class="grow" />
        {total < budget ? (
          <Chip tone="amber">{`${String(budget - total)} PT WASTED`}</Chip>
        ) : (
          <Chip tone="green">0 WASTED</Chip>
        )}
        <Button size="sm" onClick={onReroll} aria-label={`Reroll ${label} fleet`}>
          ↻ Reroll Fleet
        </Button>
      </div>
    </section>
  );
}
