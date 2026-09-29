import sanitizeHtml from 'sanitize-html';

/** Brand-authored campaign briefs rendered on public pages that share an origin with auth. */
export function sanitizeCampaignHtml(html: string): string {
  const hasBlockMarkup = /<(p|div|br|ul|ol|li|h[1-6]|blockquote|table|pre)\b/i.test(html);
  const source = hasBlockMarkup
    ? html
    : html
        .split(/\n{2,}/)
        .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
        .join('');

  return sanitizeHtml(source, {
    allowedTags: [
      'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'strong', 'b', 'em', 'i', 'u', 's', 'mark', 'small', 'sub', 'sup', 'span',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'rel', 'target'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, rel: 'nofollow noopener noreferrer', target: '_blank' },
      }),
    },
    exclusiveFilter: (frame) => frame.tag === 'p' && !frame.text.trim(),
  });
}
