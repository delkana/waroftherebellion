import type { FactionId, PlanetType } from './types';

/**
 * Canon galaxy layout. Positions are the swgalaxymap.com / Essential Atlas coordinates
 * (Coruscant at the origin, x east, y galactic north, in map units) via the Space Engine
 * community coordinate sheet. `owner` marks the entrenched strongholds of each side just
 * before the Battle of Yavin; everything else starts neutral. `lean` is the world's canon
 * sympathy (-1 Imperial ... +1 Rebel) and seeds its starting loyalty.
 */
export interface CanonWorld {
  name: string; x: number; y: number; grid: string; region: string;
  type: PlanetType; production: number; owner: FactionId | null; lean: number;
  shipyard: number; defense: number; garrison: number;
}

export const CANON_WORLDS: CanonWorld[] = [
  { name: 'Coruscant', x: 0, y: 0, grid: 'L9', region: 'Core', type: 'city', production: 16, owner: 'empire', lean: -1.0, shipyard: 3, defense: 2, garrison: 6 },
  { name: 'Kuat', x: 2802, y: -899, grid: 'M10', region: 'Core', type: 'city', production: 15, owner: 'empire', lean: -0.8, shipyard: 3, defense: 1, garrison: 3 },
  { name: 'Corellia', x: 2363, y: -2791, grid: 'M11', region: 'Core', type: 'terran', production: 14, owner: 'empire', lean: -0.3, shipyard: 2, defense: 0, garrison: 2 },
  { name: 'Fondor', x: 379, y: -5544, grid: 'L13', region: 'Colonies', type: 'barren', production: 12, owner: 'empire', lean: -0.7, shipyard: 2, defense: 0, garrison: 2 },
  { name: 'Carida', x: 2275, y: 889, grid: 'M9', region: 'Colonies', type: 'barren', production: 9, owner: 'empire', lean: -0.9, shipyard: 0, defense: 0, garrison: 4 },
  { name: 'Byss', x: -721, y: -2731, grid: 'K11', region: 'Deep Core', type: 'terran', production: 9, owner: 'empire', lean: -1.0, shipyard: 0, defense: 1, garrison: 2 },
  { name: 'Anaxes', x: 616, y: 374, grid: 'L9', region: 'Core', type: 'terran', production: 10, owner: 'empire', lean: -0.7, shipyard: 1, defense: 0, garrison: 2 },
  { name: 'Brentaal', x: 907, y: 538, grid: 'L9', region: 'Core', type: 'terran', production: 11, owner: 'empire', lean: -0.5, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Eriadu', x: 2333, y: -12440, grid: 'M18', region: 'Outer Rim', type: 'terran', production: 11, owner: 'empire', lean: -0.9, shipyard: 1, defense: 0, garrison: 2 },
  { name: 'Denon', x: 3419, y: -4748, grid: 'N13', region: 'Inner Rim', type: 'city', production: 10, owner: 'empire', lean: -0.6, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Cato Neimoidia', x: 3245, y: -2027, grid: 'N11', region: 'Colonies', type: 'terran', production: 9, owner: 'empire', lean: -0.5, shipyard: 1, defense: 0, garrison: 1 },
  { name: 'Commenor', x: 3466, y: -1474, grid: 'N10', region: 'Colonies', type: 'terran', production: 9, owner: 'empire', lean: -0.4, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Scarif', x: 8713, y: -10197, grid: 'Q17', region: 'Outer Rim', type: 'ocean', production: 7, owner: 'empire', lean: -0.8, shipyard: 0, defense: 1, garrison: 2 },
  { name: 'Yavin', x: 6876, y: 5980, grid: 'P6', region: 'Outer Rim', type: 'jungle', production: 6, owner: 'rebellion', lean: 0.9, shipyard: 2, defense: 1, garrison: 3 },
  { name: 'Dantooine', x: 15, y: 8378, grid: 'L4', region: 'Outer Rim', type: 'terran', production: 6, owner: 'rebellion', lean: 0.8, shipyard: 1, defense: 0, garrison: 2 },
  { name: 'Mon Calamari', x: 13608, y: 4952, grid: 'U6', region: 'Outer Rim', type: 'ocean', production: 12, owner: 'rebellion', lean: 0.8, shipyard: 3, defense: 1, garrison: 3 },
  { name: 'Sullust', x: 2340, y: -11720, grid: 'M17', region: 'Outer Rim', type: 'volcanic', production: 9, owner: 'rebellion', lean: 0.6, shipyard: 1, defense: 0, garrison: 2 },
  { name: 'Toprawa', x: 6138, y: 6649, grid: 'P5', region: 'Outer Rim', type: 'terran', production: 5, owner: 'rebellion', lean: 0.7, shipyard: 0, defense: 0, garrison: 2 },
  { name: 'Hoth', x: -1421, y: -12880, grid: 'K18', region: 'Outer Rim', type: 'ice', production: 3, owner: 'rebellion', lean: 0.6, shipyard: 1, defense: 0, garrison: 2 },
  { name: 'Chandrila', x: 830, y: 488, grid: 'L9', region: 'Core', type: 'terran', production: 11, owner: null, lean: 0.5, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Alderaan', x: 1942, y: -90, grid: 'M10', region: 'Core', type: 'terran', production: 12, owner: null, lean: 0.6, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Ralltiir', x: 1116, y: 658, grid: 'L9', region: 'Core', type: 'terran', production: 10, owner: null, lean: 0.3, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Thyferra', x: 989, y: -6634, grid: 'L14', region: 'Inner Rim', type: 'jungle', production: 9, owner: null, lean: -0.4, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Bestine', x: 1590, y: -6162, grid: 'M14', region: 'Inner Rim', type: 'desert', production: 5, owner: null, lean: 0.0, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Jakku', x: -4133, y: -4751, grid: 'I13', region: 'Inner Rim', type: 'desert', production: 2, owner: null, lean: 0.0, shipyard: 0, defense: 0, garrison: 0 },
  { name: 'Jedha', x: -5514, y: -3984, grid: 'H12', region: 'Mid Rim', type: 'desert', production: 4, owner: null, lean: 0.4, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Bilbringi', x: -1821, y: 2419, grid: 'J8', region: 'Inner Rim', type: 'barren', production: 8, owner: null, lean: -0.5, shipyard: 1, defense: 0, garrison: 1 },
  { name: 'Ord Mantell', x: 71, y: 3824, grid: 'L7', region: 'Mid Rim', type: 'terran', production: 7, owner: null, lean: 0.1, shipyard: 1, defense: 0, garrison: 1 },
  { name: 'Ithor', x: 1663, y: 4825, grid: 'M6', region: 'Mid Rim', type: 'jungle', production: 7, owner: null, lean: 0.2, shipyard: 0, defense: 0, garrison: 0 },
  { name: 'Taris', x: 4077, y: 4355, grid: 'N7', region: 'Outer Rim', type: 'city', production: 8, owner: null, lean: -0.1, shipyard: 1, defense: 0, garrison: 1 },
  { name: 'Mandalore', x: 5452, y: 4083, grid: 'O7', region: 'Outer Rim', type: 'desert', production: 8, owner: null, lean: 0.0, shipyard: 1, defense: 0, garrison: 2 },
  { name: 'Dathomir', x: 4717, y: 5437, grid: 'O6', region: 'Outer Rim', type: 'jungle', production: 4, owner: null, lean: 0.0, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Kashyyyk', x: 7088, y: 167, grid: 'P9', region: 'Mid Rim', type: 'jungle', production: 8, owner: null, lean: 0.5, shipyard: 0, defense: 0, garrison: 2 },
  { name: 'Umbara', x: 6113, y: -277, grid: 'P10', region: 'Expansion Region', type: 'jungle', production: 6, owner: null, lean: -0.3, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Bothawui', x: 9333, y: -6510, grid: 'R14', region: 'Mid Rim', type: 'terran', production: 9, owner: null, lean: 0.5, shipyard: 1, defense: 0, garrison: 1 },
  { name: 'Naboo', x: 5017, y: -10608, grid: 'O17', region: 'Mid Rim', type: 'terran', production: 10, owner: null, lean: 0.3, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Malastare', x: 3125, y: -10253, grid: 'N16', region: 'Mid Rim', type: 'terran', production: 7, owner: null, lean: -0.2, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Rodia', x: 8960, y: -9968, grid: 'Q16', region: 'Outer Rim', type: 'jungle', production: 6, owner: null, lean: 0.0, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Tatooine', x: 9666, y: -10099, grid: 'R16', region: 'Outer Rim', type: 'desert', production: 4, owner: null, lean: 0.1, shipyard: 0, defense: 0, garrison: 0 },
  { name: 'Geonosis', x: 9674, y: -10099, grid: 'R16', region: 'Outer Rim', type: 'desert', production: 6, owner: null, lean: -0.4, shipyard: 1, defense: 0, garrison: 1 },
  { name: 'Ryloth', x: 10069, y: -11430, grid: 'R17', region: 'Outer Rim', type: 'desert', production: 6, owner: null, lean: 0.5, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Kamino', x: 10657, y: -7962, grid: 'S15', region: 'Outer Rim', type: 'ocean', production: 9, owner: null, lean: -0.5, shipyard: 1, defense: 0, garrison: 1 },
  { name: 'Utapau', x: 3086, y: -14766, grid: 'N19', region: 'Outer Rim', type: 'desert', production: 6, owner: null, lean: 0.0, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Dagobah', x: 2461, y: -14268, grid: 'M19', region: 'Outer Rim', type: 'jungle', production: 2, owner: null, lean: 0.2, shipyard: 0, defense: 0, garrison: 0 },
  { name: 'Mustafar', x: 268, y: -14770, grid: 'L19', region: 'Outer Rim', type: 'volcanic', production: 7, owner: null, lean: -0.6, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Bespin', x: -1430, y: -12748, grid: 'K18', region: 'Outer Rim', type: 'gas', production: 9, owner: null, lean: 0.1, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Endor', x: -5148, y: -10245, grid: 'H16', region: 'Outer Rim', type: 'jungle', production: 5, owner: null, lean: 0.2, shipyard: 0, defense: 0, garrison: 0 },
  { name: 'Takodana', x: -2897, y: -9489, grid: 'J16', region: 'Mid Rim', type: 'jungle', production: 5, owner: null, lean: 0.1, shipyard: 0, defense: 0, garrison: 0 },
  { name: 'Bakura', x: -6572, y: -10064, grid: 'G16', region: 'Wild Space', type: 'terran', production: 6, owner: null, lean: 0.0, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Felucia', x: 10203, y: 5699, grid: 'R6', region: 'Outer Rim', type: 'jungle', production: 5, owner: null, lean: 0.0, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Korriban', x: 9255, y: 6991, grid: 'R5', region: 'Outer Rim', type: 'desert', production: 3, owner: null, lean: -0.2, shipyard: 0, defense: 0, garrison: 0 },
  { name: 'Kessel', x: 12545, y: -171, grid: 'T10', region: 'Outer Rim', type: 'barren', production: 6, owner: null, lean: -0.4, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Lothal', x: 14021, y: 4298, grid: 'U7', region: 'Outer Rim', type: 'terran', production: 7, owner: null, lean: 0.4, shipyard: 1, defense: 0, garrison: 1 },
  { name: 'Mygeeto', x: -764, y: 7410, grid: 'K5', region: 'Outer Rim', type: 'ice', production: 8, owner: null, lean: -0.4, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Muunilinst', x: -1208, y: 8255, grid: 'K4', region: 'Outer Rim', type: 'terran', production: 10, owner: null, lean: -0.5, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Bastion', x: -1339, y: 9700, grid: 'K3', region: 'Outer Rim', type: 'terran', production: 7, owner: null, lean: -0.5, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Ilum', x: -6195, y: 3685, grid: 'G7', region: 'Unknown Regions', type: 'ice', production: 3, owner: null, lean: 0.0, shipyard: 0, defense: 0, garrison: 0 },
  { name: 'Nal Hutta', x: 10560, y: -3087, grid: 'S12', region: 'Hutt Space', type: 'jungle', production: 8, owner: null, lean: -0.1, shipyard: 1, defense: 0, garrison: 1 },
  { name: 'Onderon', x: 5559, y: 261, grid: 'O9', region: 'Inner Rim', type: 'jungle', production: 7, owner: null, lean: 0.2, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Christophsis', x: 8652, y: -10140, grid: 'Q16', region: 'Outer Rim', type: 'terran', production: 8, owner: null, lean: -0.2, shipyard: 0, defense: 0, garrison: 1 },
  { name: 'Saleucami', x: 10997, y: 2523, grid: 'S8', region: 'Outer Rim', type: 'desert', production: 4, owner: null, lean: 0.0, shipyard: 0, defense: 0, garrison: 1 },
];
