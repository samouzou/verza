"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCarouselMarkdown = parseCarouselMarkdown;
/**
 * Parses Gemini carousel markdown into slide objects.
 * Expects ## Slide N headers and "- " bullet lines beneath each.
 * @param {string} markdown Carousel outline markdown.
 * @return {!Array<ParsedCarouselSlide>} Parsed slides.
 */
function parseCarouselMarkdown(markdown) {
    const text = markdown.trim();
    if (!text)
        return [];
    const sections = text.split(/^##\s*Slide\s+\d+/im).slice(1);
    const headerMatches = [...text.matchAll(/^##\s*Slide\s+(\d+)/gim)];
    const slides = [];
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i] ?? "";
        const index = Number(headerMatches[i]?.[1] ?? i + 1);
        const isCta = /cta/i.test(headerMatches[i]?.[0] ?? section.slice(0, 80));
        const rawLines = section
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
        const bullets = [];
        for (const line of rawLines) {
            if (!/^[-*•]/.test(line))
                continue;
            const bullet = line.replace(/^[-*•]\s*/, "").trim();
            if (bullet)
                bullets.push(bullet);
        }
        const title = bullets.shift() ?? `Slide ${index}`;
        slides.push({
            index,
            title,
            bullets,
            isCta: isCta || i === sections.length - 1,
        });
    }
    return slides.sort((a, b) => a.index - b.index);
}
