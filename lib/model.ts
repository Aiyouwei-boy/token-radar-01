// Token Radar — the value model (radar-2).
//
// One sealed snapshot in, one ranked board out. Every number on the board is
// derived from the snapshot's own figures for that protocol — its TVL, its
// seven-day TVL change, how long it has run with no token recorded, and how
// many chains it runs on. No protocol name is ever special-cased: the same
// function scores every row, and the same pre-token test that defines the
// watchlist decides which protocols may be ranked at all.
//
// Implied value, per protocol:
//   base      = tvl_usd * BASE_MULTIPLE
//   growth    = clamp(change_7d, -60, 120) percent; missing change counts as 0
//   growthMult = 1 + growth/100 * GROWTH_WEIGHT
//   maturity  = MATURITY_FLOOR + MATURITY_RANGE * sqrt(min(age_days, 1460)/1460)
//               (age unknown: 365 days; the square root rewards longevity
//                with diminishing returns — a protocol that survived two
//                bear seasons with no token is a different claim from one
//                that appeared last month)
//   breadth   = 1 + 0.04 * min(chains - 1, 5), capped at 1.20
//               (a protocol live on several chains has a wider distribution
//                surface for a future token than a single-chain one)
//   implied   = max(1, round(base * growthMult * maturity * breadth))
//
// Why these weights: a week's TVL move is the loudest signal in the snapshot,
// so growth carries the widest multiplier (about 0.1x to 2.8x at the clamps);
// age and chain breadth are tie-breakers, each worth at most about 1.2x.
// The board is therefore not a TVL list with decoration — a fast-growing,
// long-lived, multi-chain protocol outranks a larger, shrinking, single-chain
// one, and the dashboard's model playground lets a reader move the weights
// and watch the ranking move.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.2,
  growth_weight: 1.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.7,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.04,
  breadth_max_chains: 5,
};

export const MODEL_VERSION = 'radar-2';

/** Watchlist rows plus this many early rows, chosen by implied value. */
export const EARLY_ROWS = 140;

/** Live-token protocols shown apart, by market cap. */
export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow extends Omit<BoardRow, 'farm_steps' | 'gecko_id' | 'symbol'> {
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from `listedAt` to `asOf`, or null when the date is missing. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export interface Scored {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
}

/** The implied value of one protocol under the model — nothing but its own figures. */
export function impliedValue(p: SnapshotProtocol, asOf: string, m: ModelConstants): Scored {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = clamp(finite(p.change_7d, 0), m.growth_floor, m.growth_cap);
  const growthMult = 1 + (growthPct / 100) * m.growth_weight;
  const ageForModel = age ?? m.unknown_age_days;
  const maturityMult =
    m.maturity_floor +
    m.maturity_range * Math.sqrt(clamp(ageForModel, 0, m.maturity_days) / m.maturity_days);
  const extraChains = Math.min(Math.max(p.chains.length - 1, 0), m.breadth_max_chains);
  const breadthMult = 1 + extraChains * m.breadth_per_chain;
  const implied = Math.max(1, Math.round(p.tvl_usd * m.base_multiple * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** A protocol records no token when all three token fields are null. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCLUDED_CATEGORY = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

/**
 * Whether a protocol may be ranked. This is the watchlist's own test, applied
 * to every candidate: pre-token, not an exchange, not a bridge or a staked /
 * wrapped product of a token that already trades, and not a versioned pool
 * (a "V2" name) of another protocol. The watchlist passes it by construction;
 * the early rows are held to the same bar, so the board never ranks a
 * wrapped or staked product as a token that is "still to come".
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORY.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  const words = ` ${(p.name ?? '').toLowerCase()} `;
  if (words.includes(' wrapped ') || words.includes(' staked ') || words.includes(' staking ')) return false;
  return true;
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The ranked board: every watchlist slug, plus the best early rows by implied value. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Early rows are picked by the model itself, not by TVL: score every
  // rankable protocol outside the watchlist and take the strongest.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .map((p) => ({ p, score: impliedValue(p, snapshot.as_of, model).implied }))
    .sort((a, b) => b.score - a.score || (a.p.slug < b.p.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => ({ p, s: impliedValue(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map((entry, i) => {
    const { p, s } = entry;
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        base_multiple: model.base_multiple,
        growth_pct: round4(s.growthPct),
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        breadth_multiplier: round4(s.breadthMult),
        age_days: s.age,
      },
      farm_steps: farmSteps(p, s.age).map(stepText),
    };
  });
}

/** One farm step as a single string: action, cost and time, inside 20–600 chars. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Farm capital tier, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Hold length: younger protocols need a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 30;
}

function cat(p: SnapshotProtocol): string {
  return (p.category ?? '').toLowerCase();
}

/** The main position, by what the protocol actually does. */
function mainAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = cat(p);
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name} on ${chain} as collateral, then borrow $20 of stablecoin against it and repay it the same week.`;
  if (c.includes('dex'))
    return `Provide $${capital} of liquidity to ${name}'s largest USDC pool on ${chain} in a narrow range, and keep the position open.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm'))
    return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and let the yield compound.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside its app instead of bridging straight back.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position of about $50 notional.`;
  if (c.includes('prediction'))
    return `Fund $${capital} on ${name} and place one small position in a market that settles within two weeks.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk'))
    return `Deposit $${capital} into a ${name} curated vault on ${chain} and keep the vault shares for the full hold period.`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the protocol's savings module.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of the yield-bearing asset on ${name} on ${chain} and hold it through one full distribution cycle.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} for a protocol you already use, and keep the policy active.`;
  if (c.includes('payment'))
    return `Route $${capital} of real payments through ${name} on ${chain} over two weeks instead of a single transfer.`;
  if (c.includes('governance'))
    return `Deposit $${capital} into ${name}'s governance vault on ${chain} and vote on the next live proposal.`;
  if (c.includes('cedefi') || c.includes('chain'))
    return `Deposit $${capital} of USDC into ${name} on ${chain} and use its main product at least once a week.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second, different action on the same protocol, so the activity is not one-note. */
function secondAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = cat(p);
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Borrow $20 against the deposit on ${name} and swap it back to USDC on ${chain}.`;
  if (c.includes('dex'))
    return `Swap $25 through ${name} on ${chain} once a week, alternating the pair each time.`;
  if (c.includes('yield') || c.includes('farm'))
    return `Move $${Math.round(capital / 2)} of the deposit into a second ${name} vault on a different chain.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Restake the receipt token once more through ${name} instead of holding it idle.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis'))
    return `Close the hedge and reopen it once a week, keeping the margin at $${capital}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk'))
    return `Split the deposit across two ${name} vaults on ${chain} with different risk profiles.`;
  if (c.includes('rwa'))
    return `Reinvest the first distribution from ${name} back into the same asset instead of withdrawing it.`;
  if (c.includes('governance'))
    return `Delegate the voting power to an active delegate and vote directly on the following proposal.`;
  return `Use a second feature of ${name} on ${chain} — a swap, a vote or a claim — at least once a week.`;
}

/**
 * A protocol's farm plan: seven steps, each with a cost and a time, derived
 * from the protocol's own record (category, chains, TVL, age). Nothing here
 * names a token, a date or an airdrop the snapshot does not support.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm with, and write its seed phrase on paper and store it offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: mainAction(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondAction(p, capital, chain),
      cost: `about $${Math.max(2, Math.round(gas / 2))} of gas`,
      time: '10 minutes a week',
    },
    {
      text: `Do one qualifying action each week — a deposit, a swap, a borrow or a vote — and never leave the wallet untouched for a full month.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity spans more than one snapshot of the protocol.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before claiming anything, open the points or rewards page from the protocol's own site or docs and check what it actually lists for your wallet.`,
      cost: 'no fee to check, and never pay a fee to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, and plan the unwind before you need it: withdraw in two steps over two days.`,
      cost: 'nothing but the log',
      time: '5 minutes to log, 2 days to unwind',
    },
  ];
}

/** Protocols whose token already trades, shown apart by market cap — never ranked. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's whole dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
