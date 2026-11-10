import { reconcile } from '../../src/reconcile.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ result: reconcile(...data) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
