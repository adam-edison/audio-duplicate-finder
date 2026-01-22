export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

export async function searchYouTube(query: string): Promise<SearchResult[]> {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const html = await response.text();

    const results: SearchResult[] = [];
    const titleRegex = /"title":\s*\{"runs":\s*\[\{"text":\s*"([^"]+)"\}\]/g;
    const matches = html.matchAll(titleRegex);

    for (const match of matches) {
      if (results.length >= 5) {
        break;
      }

      const title = match[1];

      if (title.length < 3) {
        continue;
      }

      results.push({
        title,
        snippet: '',
        url: searchUrl,
      });
    }

    return results;
  } catch {
    return [];
  }
}

export async function searchWeb(query: string): Promise<SearchResult[]> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' song artist genre')}`;

  try {
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    const html = await response.text();
    const results: SearchResult[] = [];

    const resultRegex = /<a[^>]+class="result__a"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    const matches = html.matchAll(resultRegex);

    for (const match of matches) {
      if (results.length >= 5) {
        break;
      }

      results.push({
        title: match[1].trim(),
        snippet: match[2].replace(/<[^>]+>/g, '').trim(),
        url: '',
      });
    }

    return results;
  } catch {
    return [];
  }
}
