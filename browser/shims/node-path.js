export const dirname = (p) => String(p).replace(/\/[^/]*$/, '') || '/';
export const basename = (p) => String(p).split('/').pop();
export const extname = (p) => { const m = String(p).match(/\.[^./]*$/); return m ? m[0] : ''; };
export const join = (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');
export default { dirname, basename, extname, join };
