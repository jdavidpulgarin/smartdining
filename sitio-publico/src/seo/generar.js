export function normalizarUrl(url = 'http://localhost:5176') {
  if (!url || typeof url !== 'string') {
    return 'http://localhost:5176';
  }
  return url.replace(/\/+$/, '');
}

export function generarRobots(sitioUrl = 'http://localhost:5176') {
  const base = normalizarUrl(sitioUrl);
  return `User-agent: *
Allow: /

Sitemap: ${base}/sitemap.xml
`;
}

export function generarSitemap(sitioUrl = 'http://localhost:5176') {
  const base = normalizarUrl(sitioUrl);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${base}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
}
