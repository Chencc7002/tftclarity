const DEFAULT_SITE = 'https://tftclarity.cn/';
function allowedSite(value = DEFAULT_SITE) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || !((url.protocol === 'https:' && url.hostname === 'tftclarity.cn') || (url.protocol === 'http:' && local))) throw new Error('Only TFTClarity or a loopback development server is supported.');
  return url.origin + '/';
}
function clampBounds(bounds, workArea) {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  return {
    x: Math.round(Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width))),
    y: Math.round(Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height))),
    width, height,
  };
}
function publicLink(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
module.exports = { DEFAULT_SITE, allowedSite, clampBounds, publicLink };
