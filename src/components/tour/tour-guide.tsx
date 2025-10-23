
"use client";

import React, { useEffect, useState } from 'react';
import { useTour } from '@/hooks/use-tour';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';

export const TourGuide = () => {
  const { isTourActive, currentStep, currentStepIndex, activeTour, goToNextStep, goToPrevStep, stopTour } = useTour();
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (isTourActive && currentStep) {
      const element = document.querySelector(currentStep.selector) as HTMLElement;
      if (element) {
        setTargetElement(element);
        element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      } else {
        console.warn(`Tour step target not found: ${currentStep.selector}`);
        // Optionally skip to next step or stop tour if element not found
        // goToNextStep(); 
      }
    } else {
      setTargetElement(null);
    }
  }, [isTourActive, currentStep]);
  
  if (!isTourActive || !currentStep || !targetElement) {
    return null;
  }

  const stepCount = activeTour?.steps.length ?? 0;
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === stepCount - 1;

  return (
    <Popover open={true}>
      <PopoverTrigger asChild>
        <div ref={(node) => {
          if (node) {
            const triggerRect = targetElement.getBoundingClientRect();
            node.style.position = 'fixed';
            node.style.top = `${triggerRect.top}px`;
            node.style.left = `${triggerRect.left}px`;
            node.style.width = `${triggerRect.width}px`;
            node.style.height = `${triggerRect.height}px`;
            node.style.pointerEvents = 'none'; // Make trigger invisible to clicks
            node.style.outline = '4px solid hsl(var(--primary))';
            node.style.boxShadow = '0 0 0 9999px rgba(0, 0, 0, 0.5)';
            node.style.borderRadius = 'var(--radius)';
            node.style.zIndex = '9998'; // Below popover content
            node.style.transition = 'all 0.3s ease-in-out';
          }
        }}/>
      </PopoverTrigger>
      <PopoverContent
        side={currentStep.side || 'bottom'}
        align={currentStep.align || 'center'}
        alignOffset={10}
        className="w-80 z-[9999]"
        onInteractOutside={(e) => e.preventDefault()} // Prevent closing on outside click
        hideWhenDetached={true}
      >
        <div className="space-y-4">
          <div className="flex justify-between items-start">
            <h4 className="font-semibold text-lg">{currentStep.title}</h4>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={stopTour}>
              <X className="h-4 w-4"/>
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">{currentStep.content}</p>

          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">
              Step {currentStepIndex + 1} of {stepCount}
            </span>
            <div className="flex gap-2">
              {!isFirstStep && (
                <Button variant="outline" size="sm" onClick={goToPrevStep}>
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Prev
                </Button>
              )}
              <Button size="sm" onClick={goToNextStep}>
                {isLastStep ? 'Finish' : 'Next'}
                {!isLastStep && <ArrowRight className="h-4 w-4 ml-1" />}
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
