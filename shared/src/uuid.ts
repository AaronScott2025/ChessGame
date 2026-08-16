/** Tiny local id helper so shared code does not depend on the uuid package at runtime in the browser. */
export function v4(): string {
  return `id_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}
