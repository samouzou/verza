// This declaration file is necessary to address a specific import path used by a dependency.
// It tells TypeScript that this specific module path can be treated as 'any',
// resolving a "Could not find a declaration file" error during the Firebase Functions build.
declare module "handlebars/dist/cjs/handlebars.js";
