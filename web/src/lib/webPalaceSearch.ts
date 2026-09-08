import type { WebPalaceEntry } from "./webPalaceRegistry";

export type AlphabetizedPalaceGroup = {
  letter: string;
  palaces: WebPalaceEntry[];
};

export function filterWebPalaces(palaces: WebPalaceEntry[], searchQuery: string) {
  const query = searchQuery.trim().toLocaleLowerCase();
  const alphabetized = [...palaces].sort((a, b) => a.title.localeCompare(b.title));

  if (!query) {
    return alphabetized;
  }

  return alphabetized.filter((palace) =>
    [palace.title, palace.subject, palace.cluster, palace.summary, ...palace.tags]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query)
  );
}

export function groupWebPalacesAlphabetically(palaces: WebPalaceEntry[]) {
  return palaces.reduce<AlphabetizedPalaceGroup[]>((groups, palace) => {
    const letter = palace.title.charAt(0).toLocaleUpperCase();
    const lastGroup = groups.at(-1);

    if (lastGroup?.letter === letter) {
      lastGroup.palaces.push(palace);
    } else {
      groups.push({ letter, palaces: [palace] });
    }

    return groups;
  }, []);
}
