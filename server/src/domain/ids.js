// Mirrors the client's src/domain/ids.js exactly — server-generated
// rows (accounts) should look indistinguishable from client-generated
// ones, since both land in the same generic id column shape.
export function newId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${rand}`;
}
