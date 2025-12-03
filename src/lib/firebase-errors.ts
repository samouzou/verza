// src/lib/firebase-errors.ts

export type SecurityRuleContext = {
    path: string;
    operation: 'get' | 'list' | 'create' | 'update' | 'delete';
    requestResourceData?: any;
};

export class FirestorePermissionError extends Error {
    public context: SecurityRuleContext;

    constructor(context: SecurityRuleContext) {
        const message = `FirestoreError: Missing or insufficient permissions: The following request was denied by Firestore Security Rules:\n${JSON.stringify({
            operation: context.operation,
            path: context.path,
            requestData: context.requestResourceData,
        }, null, 2)}`;
        
        super(message);
        this.name = 'FirestorePermissionError';
        this.context = context;
        
        // This is for V8 JS environments (like some older versions of Node)
        if (typeof (Object as any).setPrototypeOf === 'function') {
            (Object as any).setPrototypeOf(this, new.target.prototype);
        } else {
            (this as any).__proto__ = new.target.prototype;
        }

        if (typeof (Error as any).captureStackTrace === 'function') {
            (Error as any).captureStackTrace(this, this.constructor);
        }
    }
}
