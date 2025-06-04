import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppWindow } from "lucide-react";
import Image from "next/image";

export function InteractivePreviewSection() {
  return (
    <div className="p-2 md:p-0">
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline text-xl flex items-center">
            <AppWindow className="mr-2 h-6 w-6 text-primary" />
            Interactive Component Previews
          </CardTitle>
          <CardDescription>
            Visualize and interact with components from your imported Verza project.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <div className="my-8 p-8 border-2 border-dashed border-border rounded-lg bg-muted/50">
            <Image 
              src="https://placehold.co/600x400.png" 
              alt="Interactive component preview placeholder" 
              width={600} 
              height={400}
              className="mx-auto rounded-md shadow-md"
              data-ai-hint="dashboard interface"
            />
            <p className="mt-6 text-muted-foreground font-medium">
              Interactive component previews will appear here.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              This area will allow you to render and test individual UI components from the Verza project in isolation.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
