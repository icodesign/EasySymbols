declare module "pathkit-wasm" {
  const initialize: (options: { wasmBinary: Uint8Array }) => Promise<unknown>;
  export default initialize;
}
