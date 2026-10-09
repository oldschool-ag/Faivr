export function agentTerminology(value: string): string {
  return value.replace(/\bworkers?\b/gi, (word) => {
    const plural = /s$/i.test(word);
    const replacement = plural ? "agents" : "agent";
    return word[0] === word[0].toUpperCase() ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
  });
}
