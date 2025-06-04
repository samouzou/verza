import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Terminal } from "lucide-react";

interface AiResponseDisplayProps {
  title: string;
  description?: string;
  details?: Record<string, string | string[]>;
  codeSnippet?: string;
  explanation?: string;
  summary?: string;
  isLoading?: boolean;
}

export function AiResponseDisplay({ 
  title, 
  description, 
  details, 
  codeSnippet, 
  explanation, 
  summary, 
  isLoading 
}: AiResponseDisplayProps) {
  if (isLoading) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-2 animate-pulse">
            <Terminal className="h-5 w-5 text-muted-foreground" />
            <p className="text-muted-foreground">Generating response...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasContent = details || codeSnippet || explanation || summary;

  if (!hasContent) {
    return null; // Don't render anything if no content and not loading
  }

  return (
    <Card className="mt-6 shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline text-lg">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">
        {summary && (
          <div>
            <h3 className="font-semibold mb-1">Summary:</h3>
            <p className="text-sm">{summary}</p>
          </div>
        )}
        {details && Object.entries(details).map(([key, value]) => (
          <div key={key}>
            <h3 className="font-semibold capitalize mb-1">{key.replace(/([A-Z])/g, ' $1')}:</h3>
            {Array.isArray(value) ? (
              <ul className="list-disc list-inside space-y-1 text-sm">
                {value.map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            ) : (
              <p className="text-sm">{value}</p>
            )}
          </div>
        ))}
        {explanation && (
          <div>
            <h3 className="font-semibold mb-1">Explanation:</h3>
            <p className="text-sm">{explanation}</p>
          </div>
        )}
        {codeSnippet && (
          <div>
            <h3 className="font-semibold mb-2 flex items-center">
              <Terminal className="h-5 w-5 mr-2" />
              Code Snippet:
            </h3>
            <pre className="bg-muted p-4 rounded-md overflow-x-auto">
              <code className="font-code text-sm">{codeSnippet}</code>
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
