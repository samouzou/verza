// This declaration file is necessary to address a specific import path used by a Genkit dependency (dotprompt).
// It tells TypeScript to use the main 'handlebars' type definitions when it encounters
// an import from 'handlebars/dist/cjs/handlebars.js', which resolves the build error.
declare module "handlebars/dist/cjs/handlebars.js" {
    import * as Handlebars from "handlebars";
    export = Handlebars;
}
