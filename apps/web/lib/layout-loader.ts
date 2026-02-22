import cytoscape from 'cytoscape';

/**
 * Lazy layout engine registration.
 * fcose is registered statically (default layout).
 * All others are loaded on first use.
 */

const registered = new Set<string>(['fcose', 'preset']);
const loading = new Map<string, Promise<void>>();

/** Map layout mode IDs to the Cytoscape extension name they require */
function getExtensionName(mode: string): string {
  if (mode.startsWith('elk-')) return 'elk';
  if (mode.startsWith('dagre-')) return 'dagre';
  if (mode === 'directed-flow') return 'preset';
  if (mode.startsWith('biflow-')) return 'preset';
  return mode; // cola
}

async function loadExtension(name: string): Promise<void> {
  const resolveExtension = (mod: any) => {
    if (typeof mod === 'function') return mod;
    if (typeof mod?.default === 'function') return mod.default;
    if (typeof mod?.default?.default === 'function') return mod.default.default;
    throw new Error(`Failed to resolve Cytoscape extension "${name}"`);
  };

  switch (name) {
    case 'cola': {
      const mod = await import('cytoscape-cola');
      cytoscape.use(resolveExtension(mod));
      break;
    }
    case 'elk': {
      const mod = await import('cytoscape-elk');
      cytoscape.use(resolveExtension(mod));
      break;
    }
    case 'dagre': {
      const mod = await import('cytoscape-dagre');
      cytoscape.use(resolveExtension(mod));
      break;
    }
  }
}

/**
 * Ensure the layout engine for a given mode is registered with Cytoscape.
 * Returns immediately if already registered; otherwise dynamically imports the extension.
 */
export async function ensureLayoutRegistered(mode: string): Promise<void> {
  const extName = getExtensionName(mode);

  if (registered.has(extName)) return;

  // Deduplicate concurrent loads
  if (loading.has(extName)) {
    return loading.get(extName);
  }

  const promise = loadExtension(extName)
    .then(() => {
      registered.add(extName);
    })
    .finally(() => {
      loading.delete(extName);
    });

  loading.set(extName, promise);
  return promise;
}
