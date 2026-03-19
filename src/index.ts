import { config } from '../config.js';

export default {
  async fetch(request: Request, env: any, ctx: any) {

    // Extracting configuration values
    const domainSource = config.domainSource;
    const patterns = config.patterns;

    console.log("Worker started");

    // Parse the request URL
    const url = new URL(request.url);

    // Redirect HTTP → HTTPS
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }

    const referer = request.headers.get('Referer')

    // Function to get the pattern configuration that matches the URL
    function getPatternConfig(url: string) {
      for (const patternConfig of patterns) {
        const regex = new RegExp(patternConfig.pattern);
        let pathname = url + (url.endsWith('/') ? '' : '/');
        if (regex.test(pathname)) {
          return patternConfig;
        }
      }
      return null;
    }

    // Function to check if the URL matches the page data pattern (For the WeWeb app)
    function isPageData(url: string) {
      const pattern = /\/public\/data\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json/;
      return pattern.test(url);
    }

    async function requestMetadata(url: any, metaDataEndpoint: any) {
      try {
        console.log("Requesting metadata for URL:", url);
        // Use URL object to parse correctly whether it's a full URL or pathname
        const urlObj = url.startsWith('http') ? new URL(url) : new URL(url, 'http://localhost');
        const pathname = urlObj.pathname.endsWith('/') ? urlObj.pathname.slice(0, -1) : urlObj.pathname;
        const parts = pathname.split('/').filter(p => p !== '');

        console.log("URL parts:", parts);
        const id = parts[parts.length - 1];
        const languageCode = parts[0]; // Assuming language code is the first part as per current patterns
        console.log("Extracted ID:", id, "Language Code:", languageCode);

        // Replace the placeholders in metaDataEndpoint with actual values
        const metaDataEndpointWithValues = metaDataEndpoint
          .replace(/{id}/g, id)
          .replace(/{language_code}/g, languageCode);

        console.log("Fetching from metadata endpoint:", metaDataEndpointWithValues);

        // Fetch metadata from the API endpoint
        const metaDataResponse = await fetch(metaDataEndpointWithValues);
        if (!metaDataResponse.ok) {
          console.error("Metadata API returned error:", metaDataResponse.status);
          return { metadata: null, languageCode, id };
        }
        const metadata = await metaDataResponse.json();
        return { metadata, languageCode, id };
      } catch (error) {
        console.error("Critical error in requestMetadata:", error);
        return { metadata: null, languageCode: 'en', id: 'unknown' };
      }
    }

    // Handle dynamic page requests
    const patternConfig = getPatternConfig(url.pathname);
    if (patternConfig) {
      console.log("Dynamic page detected:", url.pathname);

      // Fetch the source page content - follow redirects to get actual HTML
      // (WeWeb preview often 301-redirects to add a trailing slash)
      let source = await fetch(`${domainSource}${url.pathname}${url.search}`, {
        redirect: 'follow'
      });

      // Remove "X-Robots-Tag" from the headers
      const sourceHeaders = new Headers(source.headers);
      sourceHeaders.delete('X-Robots-Tag');
      source = new Response(source.body as any, {
        status: source.status,
        headers: sourceHeaders
      });

      const { metadata, languageCode } = await requestMetadata(url.pathname, patternConfig.metaDataEndpoint);
      console.log("Metadata status:", !!metadata, "Lang:", languageCode);

      // Add debug headers
      sourceHeaders.set('x-worker-dynamic-metadata', 'active');
      sourceHeaders.set('x-metadata-status', metadata ? 'success' : 'missing');

      const canonicalUrl = `https://www.openlogistics.network${url.pathname}${url.pathname.endsWith('/') ? '' : '/'}`;
      const customHeaderHandler = new CustomHeaderHandler(metadata, canonicalUrl, domainSource, url.pathname);

      // Transform the source HTML with the custom headers
      console.log("Transforming HTML with HTMLRewriter");
      return new HTMLRewriter()
        .on('*', customHeaderHandler)
        .transform(new Response(source.body as any, {
          status: source.status,
          headers: sourceHeaders
        }));

      // Handle page data requests for the WeWeb app
    } else if (isPageData(url.pathname)) {
      console.log("Page data detected:", url.pathname);
      console.log("Referer:", referer);

      // Fetch the source data content - don't follow redirects
      const sourceResponse = await fetch(`${domainSource}${url.pathname}`, {
        redirect: 'manual'
      });
      let sourceData = await sourceResponse.json();

      let pathname = referer;
      pathname = pathname ? pathname + (pathname.endsWith('/') ? '' : '/') : null;
      if (pathname !== null) {
        const patternConfigForPageData = getPatternConfig(pathname);
        if (patternConfigForPageData) {
          const { metadata, languageCode } = await requestMetadata(pathname, patternConfigForPageData.metaDataEndpoint);
          console.log("Metadata fetched for SPA navigation:", !!metadata, languageCode);
          const lang = languageCode || 'en';
          const data: any = sourceData;

          // Ensure nested objects exist in the source data
          data.page = data.page || {};
          data.page.title = data.page.title || {};
          data.page.meta = data.page.meta || {};
          data.page.meta.desc = data.page.meta.desc || {};
          data.page.meta.keywords = data.page.meta.keywords || {};
          data.page.socialTitle = data.page.socialTitle || {};
          data.page.socialDesc = data.page.socialDesc || {};

          // Update source data with the fetched metadata
          const metadataObj: any = metadata;
          if (metadataObj && metadataObj.title) {
            data.page.title[lang] = metadataObj.title;
            data.page.socialTitle[lang] = metadataObj.title;
          }
          if (metadataObj && metadataObj.description) {
            data.page.meta.desc[lang] = metadataObj.description;
            data.page.socialDesc[lang] = metadataObj.description;
          }
          if (metadataObj && metadataObj.image) {
            data.page.metaImage = metadataObj.image;
          }
          if (metadataObj && metadataObj.keywords) {
            data.page.meta.keywords[lang] = metadataObj.keywords;
          }

          console.log(`Returning modified JSON for SPA (${lang})`);
          // Return the modified JSON object
          return new Response(JSON.stringify(data), {
            headers: {
              'Content-Type': 'application/json',
              'x-worker-dynamic-metadata': 'active-spa',
              'x-metadata-status': 'success'
            }
          });
        }
      }
    }

    // If the URL does not match any patterns, fetch and return the original content
    console.log("Fetching original content for:", url.pathname);
    const sourceUrl = new URL(`${domainSource}${url.pathname}${url.search}`);
    const sourceResponse = await fetch(sourceUrl, {
      redirect: 'manual'
    });

    // Create a new response without the "X-Robots-Tag" header
    const modifiedHeaders = new Headers(sourceResponse.headers);
    modifiedHeaders.delete('X-Robots-Tag');

    // Handle redirect responses - rewrite Location header to stay on worker domain
    if (sourceResponse.status >= 300 && sourceResponse.status < 400) {
      const location = sourceResponse.headers.get('Location');
      if (location) {
        // Parse the redirect location and rewrite to current origin
        const redirectUrl = new URL(location, domainSource);
        const newLocation = `${url.origin}${redirectUrl.pathname}${redirectUrl.search}`;
        console.log("Rewriting redirect from:", location, "to:", newLocation);
        modifiedHeaders.set('Location', newLocation);
      }
    }

    const contentType = sourceResponse.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      console.log("Transforming static HTML to remove staging domains");
      const domainSourceHost = new URL(domainSource).host;
      const prodHost = 'www.openlogistics.network';

      const stagingScrubber = {
        element(element: any) {
          for (const attr of ['href', 'content', 'src']) {
            const val = element.getAttribute(attr);
            if (val && val.includes(domainSourceHost)) {
              element.setAttribute(attr, val.replace(domainSourceHost, prodHost));
            }
          }
        }
      };

      const canonicalUrl = `https://www.openlogistics.network${url.pathname}${url.pathname.endsWith('/') ? '' : '/'}`;
      const canonicalInjector = {
        element(element: any) {
          element.append(`<link rel="canonical" href="${canonicalUrl}"/>`, { html: true });
        }
      };

      // Detect language from URL path (e.g. /en/, /de/)
      const pathParts = url.pathname.split('/').filter((p: string) => p !== '');
      const lang = pathParts[0] || 'en';
      const noscriptCopy: Record<string, { h1: string; p: string }> = {
        en: { h1: 'Open Logistics Network', p: 'Digital 3PL marketplace connecting shippers with global warehouse capacity. Enable JavaScript to explore our platform.' },
        de: { h1: 'Open Logistics Network', p: 'Digitaler 3PL-Marktplatz, der Verlader mit weltweiten Lagerkapazitäten verbindet. Aktivieren Sie JavaScript, um unsere Plattform zu erkunden.' },
        es: { h1: 'Open Logistics Network', p: 'Marketplace digital 3PL que conecta cargadores con capacidad de almacenamiento global. Active JavaScript para explorar nuestra plataforma.' },
        fr: { h1: 'Open Logistics Network', p: 'Marketplace 3PL numérique reliant les expéditeurs aux capacités d\'entrepôt mondiales. Activez JavaScript pour explorer notre plateforme.' },
        pt: { h1: 'Open Logistics Network', p: 'Marketplace digital 3PL conectando embarcadores com capacidade de armazém global. Ative o JavaScript para explorar nossa plataforma.' },
        it: { h1: 'Open Logistics Network', p: 'Marketplace digitale 3PL che collega spedizionieri con capacità di magazzino globale. Abilita JavaScript per esplorare la nostra piattaforma.' },
        ja: { h1: 'Open Logistics Network', p: 'シッパーと世界の倉庫キャパシティをつなぐデジタル3PLマーケットプレイス。プラットフォームを利用するにはJavaScriptを有効にしてください。' },
        pl: { h1: 'Open Logistics Network', p: 'Cyfrowy marketplace 3PL łączący nadawców z globalną pojemnością magazynową. Włącz JavaScript, aby korzystać z naszej platformy.' },
      };
      const copy = noscriptCopy[lang] || noscriptCopy['en'];
      const noscriptInjector = {
        element(element: any) {
          element.setInnerContent(
            `<h1>${copy.h1}</h1><p>${copy.p}</p>`,
            { html: true }
          );
        }
      };

      const appContentInjector = {
        element(element: any) {
          element.setInnerContent(
            `<h1>${copy.h1}</h1><p>${copy.p}</p>`,
            { html: true }
          );
        }
      };

      return new HTMLRewriter()
        .on('link', stagingScrubber)
        .on('meta', stagingScrubber)
        .on('a', stagingScrubber)
        .on('img', stagingScrubber)
        .on('script', stagingScrubber)
        .on('head', canonicalInjector)
        .on('noscript', noscriptInjector)
        .on('[id="app"]', appContentInjector)
        .transform(new Response(sourceResponse.body, {
          status: sourceResponse.status,
          headers: modifiedHeaders,
        }));
    }

    return new Response(sourceResponse.body, {
      status: sourceResponse.status,
      headers: modifiedHeaders,
    });
  }
};

// Escape special characters in metadata values for safe HTML attribute injection
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Meta tag attributes that we inject — used to remove existing duplicates
const CONFLICTING_NAMES = ["title", "description", "keywords", "image", "twitter:title", "twitter:description", "twitter:image"];
const CONFLICTING_PROPERTIES = ["og:title", "og:description", "og:image"];
const CONFLICTING_ITEMPROPS = ["name", "description", "image"];

// CustomHeaderHandler class to modify HTML content based on metadata
class CustomHeaderHandler {
  metadata: any;
  canonicalUrl: string | null;
  domainSource: string | null;
  currentPathname: string | null;
  noindexInjected: boolean;
  scriptLdInjected: boolean;
  metaInjected: boolean;

  constructor(metadata: any, canonicalUrl: string | null = null, domainSource: string | null = null, currentPathname: string | null = null) {
    this.metadata = metadata;
    this.canonicalUrl = canonicalUrl;
    this.domainSource = domainSource;
    this.currentPathname = currentPathname;
    this.noindexInjected = false;
    this.scriptLdInjected = false;
    this.metaInjected = false;
  }

  element(element: any) {
    if (!this.metadata && !this.canonicalUrl) return;

    // --- <head>: inject all meta tags and structured data ---
    if (element.tagName == "head") {
      // Inject noindex for unpublished records
      if (this.metadata && this.metadata.is_published === false && !this.noindexInjected) {
        console.log('Injecting noindex meta tag for unpublished record');
        element.prepend('<meta name="robots" content="noindex">', { html: true });
        this.noindexInjected = true;
      }

      // Inject all SEO / OG / Twitter / itemprop meta tags
      if (!this.metaInjected) {
        const m = this.metadata || {};
        let inject = '';

        if (m.title) {
          const t = escapeHtml(m.title);
          inject += `    <title>${t}</title>\n`;
          inject += `    <meta name="title" content="${t}" />\n`;
          inject += `    <meta property="og:title" content="${t}" />\n`;
          inject += `    <meta name="twitter:title" content="${t}" />\n`;
          inject += `    <meta itemprop="name" content="${t}" />\n`;
        }
        if (m.description) {
          const d = escapeHtml(m.description);
          inject += `    <meta name="description" content="${d}" />\n`;
          inject += `    <meta property="og:description" content="${d}" />\n`;
          inject += `    <meta name="twitter:description" content="${d}" />\n`;
          inject += `    <meta itemprop="description" content="${d}" />\n`;
        }
        if (m.image) {
          const img = escapeHtml(m.image);
          inject += `    <meta name="image" content="${img}" />\n`;
          inject += `    <meta property="og:image" content="${img}" />\n`;
          inject += `    <meta name="twitter:image" content="${img}" />\n`;
          inject += `    <meta itemprop="image" content="${img}" />\n`;
        }
        if (m.keywords) {
          inject += `    <meta name="keywords" content="${escapeHtml(m.keywords)}" />\n`;
        }
        if (this.canonicalUrl) {
          inject += `    <link rel="canonical" href="${escapeHtml(this.canonicalUrl)}" />\n`;
        }

        if (inject) {
          console.log('Injecting meta tags into <head>');
          element.append(inject, { html: true });
        }
        this.metaInjected = true;
      }

      // Inject JSON-LD structured data script at the end of head
      if (!this.scriptLdInjected && this.metadata && this.metadata.script_ld) {
        try {
          console.log('Injecting JSON-LD structured data script');
          element.append(this.metadata.script_ld, { html: true });
          this.scriptLdInjected = true;
        } catch (error) {
          console.error('Error injecting JSON-LD script:', error);
        }
      }

      return;
    }

    // --- <div id="app">: pre-fill with metadata so Google sees content before Vue mounts ---
    if (element.tagName === 'div' && element.getAttribute('id') === 'app') {
      const m = this.metadata || {};
      const title = m.title ? escapeHtml(m.title) : 'Open Logistics Network';
      const description = m.description ? escapeHtml(m.description) : '';
      let content = `<h1>${title}</h1>`;
      if (description) content += `<p>${description}</p>`;
      element.setInnerContent(content, { html: true });
      return;
    }

    // --- <noscript>: inject text content so Googlebot doesn't see an empty body ---
    if (element.tagName === 'noscript') {
      const m = this.metadata || {};
      const title = m.title ? escapeHtml(m.title) : 'Open Logistics Network';
      const description = m.description ? escapeHtml(m.description) : '';
      let content = `<h1>${title}</h1>`;
      if (description) content += `<p>${description}</p>`;
      element.setInnerContent(content, { html: true });
      return;
    }

    // --- <link>: handle canonical and hreflang alternate tags ---
    if (element.tagName === "link") {
      const rel = element.getAttribute("rel");
      if (rel === "canonical" && this.canonicalUrl) {
        element.remove();
        return;
      }
      // Rewrite hreflang alternate links: replace preview domain with production domain
      // and replace :param placeholder with the actual location ID
      if (rel === "alternate" && this.domainSource && this.currentPathname) {
        const href = element.getAttribute("href");
        if (href && href.includes(this.domainSource)) {
          const pathParts = this.currentPathname.split('/').filter((p: string) => p !== '');
          const locationId = pathParts[pathParts.length - 1];
          const newHref = href
            .replace(this.domainSource, 'https://www.openlogistics.network')
            .replace(':param', locationId);
          element.setAttribute("href", newHref);
          return;
        }
      }
    }

    // --- <title>: remove existing title tag since we inject a new one ---
    if (element.tagName == "title" && this.metadata && this.metadata.title) {
      console.log('Removing existing <title> tag (replaced by injected one)');
      element.remove();
      return;
    }

    // --- <meta>: remove existing tags that conflict with injected ones ---
    if (element.tagName == "meta" && this.metadata) {
      const name = element.getAttribute("name");
      const property = element.getAttribute("property");
      const itemprop = element.getAttribute("itemprop");

      // Handle robots meta tag based on is_published status (don't remove, handle specifically)
      if (name === "robots") {
        if (this.metadata.is_published === false) {
          console.log('Removing existing robots tag (keeping injected noindex for unpublished record)');
          element.remove();
        } else if (this.metadata.is_published === true) {
          const content = element.getAttribute("content");
          if (content === "noindex") {
            console.log('Removing noindex tag (record is published)');
            element.remove();
          }
        }
        return;
      }

      // Remove any meta tag that conflicts with what we injected
      if (
        (name && CONFLICTING_NAMES.includes(name)) ||
        (property && CONFLICTING_PROPERTIES.includes(property)) ||
        (itemprop && CONFLICTING_ITEMPROPS.includes(itemprop))
      ) {
        console.log(`Removing conflicting existing meta tag: name=${name} property=${property} itemprop=${itemprop}`);
        element.remove();
        return;
      }
    }
  }
}
