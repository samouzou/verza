declare module 'mammoth' {
    export interface Result {
        value: string;
        messages: any[];
    }

    export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<Result>;
    export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<Result>;
}
