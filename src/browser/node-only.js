function unavailable() {
  throw new Error(
    "This RiX capability requires Node.js file access and is not available in RiX Notebook. "
    + "Notebook module imports will use the project-aware resolver instead.",
  );
}

const nodeOnly = new Proxy({}, {
  get() {
    return unavailable;
  },
});

export default nodeOnly;

export function createRequire() {
  return unavailable;
}
