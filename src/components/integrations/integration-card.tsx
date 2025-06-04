"use client";

import type { ComponentType, ComponentProps, JSXElementConstructor } from "react";
import { useState, Suspense, lazy } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

interface IntegrationCardProps {
  serviceName: string;
  ServiceIcon: ComponentType<any>;
  description: string;
  isConnectedInitial?: boolean;
}

interface IntegrationCardPropsWithLoader extends Omit<IntegrationCardProps, 'ServiceIcon'> {
  serviceIconName: string;
}

export function IntegrationCard({ serviceName, serviceIconName, description, isConnectedInitial = false }: IntegrationCardPropsWithLoader) {
  const [isConnected, setIsConnected] = useState(isConnectedInitial);
  const [isLoading, setIsLoading] = useState(false);

  function ServiceIconComponent(props: ComponentProps<any>) {
    let LazyServiceIcon: ComponentType<any>;

    switch (serviceIconName) {
      case "Mail":
        LazyServiceIcon = lazy(() => import("lucide-react").then((module) => ({ default: module.Mail })));
        break;
      case "Database":
        LazyServiceIcon = lazy(() => import("lucide-react").then((module) => ({ default: module.Database })));
        break;
      case "Cloud":
        LazyServiceIcon = lazy(() => import("lucide-react").then((module) => ({ default: module.Cloud })));
        break;
      default:
        throw new Error(`Unknown serviceIconName: ${serviceIconName}`);
    }
    return (
        <Suspense fallback={<div>Loading...</div>}>
          <LazyServiceIcon {...props} />
        </Suspense>
    );
  }


  const handleToggleConnection = () => {
    setIsLoading(true);
    // Simulate API call
    setTimeout(() => {
      setIsConnected(!isConnected);
      setIsLoading(false);
    }, 1000);
  };

  return (
    <Card className="shadow-lg">
      <CardHeader className="flex flex-row items-start gap-4 space-y-0">
        <div className="p-2 bg-muted rounded-lg">
          <ServiceIconComponent className={cn("h-8 w-8 text-primary")} />


        </div>
        <div>
          <CardTitle>{serviceName}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between sm:items-center">
        <div className="flex items-center text-sm">
          {isConnected ? (
            <>
              <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
              <span>Connected</span>
            </>
          ) : (
            <>
              <XCircle className="h-5 w-5 text-destructive mr-2" />
              <span>Not Connected</span>
            </>
          )}
        </div>
        <Button
          onClick={handleToggleConnection}
          variant={isConnected ? "destructive" : "default"}
          disabled={isLoading}
          className="w-full sm:w-auto"
        >
          {isLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          {isLoading
            ? isConnected ? 'Disconnecting...' : 'Connecting...'
            : isConnected ? 'Disconnect' : `Connect ${serviceName}`}
        </Button>
      </CardContent>
    </Card>
  );
}
