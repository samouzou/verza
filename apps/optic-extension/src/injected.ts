import {
  collectHashtagPostUrls,
  collectKeywordAccountUrls,
  detectLoggedInUsername,
  prepareHashtagExplore,
  prepareKeywordSearch,
  scrapeInstagramProfile,
  scrapePostAuthor,
} from "./instagram/scrape";
import {
  collectLinkedInPeopleUrls,
  detectLoggedInLinkedInSlug,
  prepareLinkedInPeopleSearch,
  scrapeLinkedInProfile,
} from "./linkedin/scrape";
import {
  collectXUserUrls,
  detectLoggedInXHandle,
  prepareXUserSearch,
  scrapeXProfile,
} from "./x/scrape";

declare global {
  interface Window {
    __VERZA_OPTIC?: Record<string, (...a: never[]) => unknown>;
  }
}

window.__VERZA_OPTIC = {
  prepareHashtagExplore,
  collectHashtagPostUrls,
  prepareKeywordSearch,
  collectKeywordAccountUrls,
  scrapePostAuthor,
  detectLoggedInUsername,
  scrapeInstagramProfile,
  prepareLinkedInPeopleSearch,
  collectLinkedInPeopleUrls,
  scrapeLinkedInProfile,
  detectLoggedInLinkedInSlug,
  prepareXUserSearch,
  collectXUserUrls,
  scrapeXProfile,
  detectLoggedInXHandle,
} as Window["__VERZA_OPTIC"];
