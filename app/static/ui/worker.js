import { reconcileTables } from '../../src/multi.js';
import { readBytes, exportMultiWorkbook } from '../../src/files.js';
self.onmessage = async ({ data }) => {
  try {
    const result = data.operation === 'parse' ? await readBytes(data.bytes, data.name, data.sheet)
      : data.operation === 'export' ? await exportMultiWorkbook(data.run, data.files, data.options)
      : reconcileTables(data.files, data.config);
    self.postMessage({ result });
  }
  catch (error) { self.postMessage({ error: error.message }); }
};
