const electronMock =
  "data:text/javascript," +
  encodeURIComponent(
    "export const nativeImage = { createFromBuffer: () => ({ resize: () => ({ toPNG: () => Buffer.alloc(0) }), toPNG: () => Buffer.alloc(0), getSize: () => ({ width: 0, height: 0 }) }) };",
  );

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "electron") return { url: electronMock, shortCircuit: true };
  return nextResolve(specifier, context);
}
