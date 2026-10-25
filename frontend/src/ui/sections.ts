/** Inspector sections the user can fold (Height protection has its own `floorPanelOpen`). Ids avoid the words the UI-92 test forbids. */
export const SECTION_IDS = ["box", "polygon", "cluster", "sparse", "plane", "thin", "selection", "layers"] as const;
export type SectionId = (typeof SECTION_IDS)[number];
/** Only closed sections are stored; a missing id means open. */
export type SectionsOpen = Partial<Record<SectionId, boolean>>;

export const isSectionOpen = (m: SectionsOpen, id: SectionId): boolean => m[id] !== false;

export function setSectionOpen(m: SectionsOpen, id: SectionId, open: boolean): SectionsOpen {
  const { [id]: _drop, ...rest } = m;
  return open ? rest : { ...rest, [id]: false };
}
