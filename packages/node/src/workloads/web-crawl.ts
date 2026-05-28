import type { WebCrawlPayload, WebCrawlResult } from '@flaxia/sdk';
import { checkRobotsTxt } from './robots-cache';

function extractBySelectors(doc: Document, selectors: string[]): string {
  const parts: string[] = [];
  for (const sel of selectors) {
    doc.querySelectorAll(sel).forEach(el => {
      const text = (el as HTMLElement).textContent?.trim();
      if (text) parts.push(text);
    });
  }
  return parts.join('\n\n');
}

function cleanText(text: string): string {
  return text
    .replace(/\t/g, ' ')
    .replace(/ +/g, ' ')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .join('\n');
}

function extractMainContent(doc: Document): string {
  const article = doc.querySelector('article');
  if (article) return cleanText(article.textContent || '');

  const main = doc.querySelector('main, [role="main"]');
  if (main) return cleanText(main.textContent || '');

  const body = doc.body;
  if (!body) return '';

  const clone = body.cloneNode(true) as HTMLElement;
  const removeSelectors = ['script', 'style', 'nav', 'header', 'footer', 'aside'];
  for (const sel of removeSelectors) {
    clone.querySelectorAll(sel).forEach(el => el.remove());
  }
  return cleanText(clone.textContent || '');
}

function extractSameOriginLinks(doc: Document, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const links = new Set<string>();
  doc.querySelectorAll('a[href]').forEach(a => {
    try {
      const href = (a as HTMLAnchorElement).href;
      const url = new URL(href, baseUrl);
      if (url.origin === base.origin && !url.hash) {
        links.add(url.href);
      }
    } catch {}
  });
  return Array.from(links).slice(0, 100);
}

export async function handleWebCrawl(payload: WebCrawlPayload): Promise<WebCrawlResult> {
  const { url, extractSelectors, respectRobotsTxt = true } = payload;
  const startTime = performance.now();

  if (respectRobotsTxt) {
    const allowed = await checkRobotsTxt(url);
    if (!allowed) throw new Error(`Blocked by robots.txt: ${url}`);
  }

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'VectoriaCrawler/1.0 (FlaxiaCrowd)',
      'Accept': 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });

  const html = await response.text();
  const duration = performance.now() - startTime;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const title = doc.querySelector('title')?.textContent?.trim() || url;

  let content = '';
  if (extractSelectors && extractSelectors.length > 0) {
    content = extractBySelectors(doc, extractSelectors);
  } else {
    content = extractMainContent(doc);
  }

  const links = extractSameOriginLinks(doc, url);

  return {
    url: response.url,
    title,
    content,
    format: 'text',
    metadata: {
      contentType: response.headers.get('content-type') || '',
      contentLength: html.length,
      fetchDurationMs: Math.round(duration),
      statusCode: response.status,
    },
    links,
  };
}
