// Boot wrapper (index.html loads this, not main.js): a start-up that fails shows why on the loading screen instead of
// leaving a black page. main.js runs at import (top-level await), so its failure is this import's rejection.
import { loading } from './ui/loading.js';

const gl = document.createElement('canvas').getContext('webgl2');
if (!gl) {
  loading.fail('WebGL2 is not available', 'Turn on hardware acceleration in the browser settings, or use a current Chrome, Edge, Firefox or Safari.');
} else {
  gl.getExtension('WEBGL_lose_context')?.loseContext(); // probe only: free it before the renderer makes its own
  import('./main.js').catch((e) => { loading.fail('The game failed to start', String(e?.message ?? e)); throw e; });
}
