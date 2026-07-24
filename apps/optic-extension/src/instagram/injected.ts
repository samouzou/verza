import {
  collectHashtagPostUrls,
  collectKeywordAccountUrls,
  detectLoggedInUsername,
  prepareHashtagExplore,
  prepareKeywordSearch,
  scrapeInstagramProfile,
  scrapePostAuthor,
} from "./scrape";

declare global {
  interface Window {
    __VERZA_OPTIC?: {
      prepareHashtagExplore: typeof prepareHashtagExplore;
      collectHashtagPostUrls: typeof collectHashtagPostUrls;
      prepareKeywordSearch: typeof prepareKeywordSearch;
      collectKeywordAccountUrls: typeof collectKeywordAccountUrls;
      scrapePostAuthor: typeof scrapePostAuthor;
      detectLoggedInUsername: typeof detectLoggedInUsername;
      scrapeInstagramProfile: typeof scrapeInstagramProfile;
    };
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
};
