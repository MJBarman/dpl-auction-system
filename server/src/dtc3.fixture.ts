import { buildInitialState, generateCode } from './seed';
import { Player, State } from './types';

// The DTC Season 3 pool the engine tests were written against: 24 players in
// four categories (base 1,000 / 600 / 400 / 200), two teams buying exactly 12
// each, purse 30,000. It is no longer the app's seed (seed.ts holds the DCT
// list now); the tests keep it because its spread of base prices is what
// exercises the purse guardrail. Test-only: tsconfig leaves *.fixture.ts out
// of the build.

const TIERS = [
  { key: 'diamond', name: 'Diamond', basePrice: 1000, color: '#67e8f9', order: 1 },
  { key: 'gold', name: 'Gold', basePrice: 600, color: '#fbbf24', order: 2 },
  { key: 'emerald', name: 'Emerald', basePrice: 400, color: '#34d399', order: 3 },
  { key: 'new', name: 'New Players', basePrice: 200, color: '#c4b5fd', order: 4 },
];

// In the DTC 3 seed's order (overall MVP rank), so the ids match its dtc3-p<n>.
const POOL: [name: string, tierKey: string][] = [
  ['Hirak', 'diamond'], ['Padum', 'diamond'],
  ['Asif', 'gold'], ['Kaustav', 'gold'], ['Uddhab', 'gold'], ['Bhokto', 'gold'],
  ['Kabya', 'emerald'], ['Jishnu', 'emerald'], ['Chandan', 'emerald'], ['Dharmendra', 'emerald'],
  ['Madhurjya', 'emerald'], ['Bineet', 'emerald'], ['Sonu', 'emerald'], ['Chinmoy Sr', 'emerald'],
  ['Amlan', 'emerald'], ['Deep', 'emerald'], ['Chinmoy Jr', 'emerald'], ['Vishal', 'emerald'],
  ['Udit', 'new'], ['Ronny', 'new'], ['Abhigyan', 'new'], ['Yatrick', 'new'], ['Debanga', 'new'], ['Alokesh', 'new'],
];

export function dtc3State(): State {
  const s = buildInitialState(); // DCT settings: purse 30,000, reserve 0, the same bid ladder and timeouts
  s.settings.auctionName = 'DTC Season 3 Player Auction';
  s.settings.minSquad = 12;
  s.settings.maxSquad = 12;
  s.settings.tiers = TIERS.map((t) => ({ ...t }));
  s.teams = [
    { id: 't1', name: 'Power Rangers', captain: 'Ashish', owner: 'Angshumaan', color: '#f43f5e', code: generateCode() },
    { id: 't2', name: 'Underdogs', captain: 'Saurav', owner: 'Ankur', color: '#3b82f6', code: generateCode() },
  ];
  s.players = POOL.map(([name, tierKey], i): Player => ({
    id: `dtc3-p${i + 1}`,
    name,
    role: '',
    tierKey,
    basePriceOverride: null,
    stats: {},
    notes: '',
    demandRank: null,
    sleeper: false,
    status: 'available',
    teamId: null,
    price: null,
    round: null,
    offeredInPass: false,
    photoPath: null,
    photoCode: generateCode(10),
  }));
  return s;
}
